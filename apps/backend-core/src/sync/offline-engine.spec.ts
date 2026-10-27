// @ts-nocheck — importهای نسبی به web-panel (بدون پسوند .js) فقط برای vitest؛ این فایل در build کامپایل نمی‌شود
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// موتور آفلاین سمت مرورگر (web-panel/src/lib/offline) — خالص و بدون React؛ از اینجا با fake-indexeddb آزمون می‌شود.
const W = resolve(__dirname, '../../../web-panel/src/lib/offline');
const load = async <T>(f: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(`${W}/${f}.ts`).href)) as T;

type Mods = {
  idb: typeof import('../../../web-panel/src/lib/offline/idb');
  store: typeof import('../../../web-panel/src/lib/offline/store');
  engine: typeof import('../../../web-panel/src/lib/offline/engine');
  reg: typeof import('../../../web-panel/src/lib/offline/registry');
  crypto: typeof import('../../../web-panel/src/lib/offline/crypto');
};
let M: Mods;
beforeEach(async () => {
  M = { idb: await load('idb'), store: await load('store'), engine: await load('engine'), reg: await load('registry'), crypto: await load('crypto') };
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Handler = (c: Call) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function setup(handler: Handler, opts: { user?: string; tenant?: string; factory?: IDBFactory; online?: () => boolean; token?: () => string | null; now?: () => number } = {}) {
  const factory = opts.factory ?? new IDBFactory();
  const db = new M.idb.IdbDb(factory);
  const store = new M.store.OfflineStore(db, { tenantId: opts.tenant ?? 't1', userId: opts.user ?? 'u1' });
  const calls: Call[] = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call: Call = { url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  const engine = new M.engine.SyncEngine({
    store,
    apiUrl: '/api',
    getToken: opts.token ?? (() => 'tok'),
    fetchImpl,
    isOnline: opts.online ?? (() => true),
    random: () => 1,
    newId: () => `id${(n += 1).toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
    probe: async () => true,
    now: opts.now,
  });
  const op = (key: string) => M.reg.OFFLINE_OPS.find((o) => o.key === key)!;
  return { factory, db, store, engine, calls, op };
}

describe('registry matcher', () => {
  it('matches known ops, rejects online-only and official invoices', async () => {
    expect(M.reg.matchOp('POST', '/crm/contacts', {})?.op.key).toBe('crm.contact.create');
    expect(M.reg.matchOp('PATCH', '/daily-checklist/abc', { done: true })?.op.key).toBe('checklist.toggle');
    expect(M.reg.matchOp('PATCH', '/daily-checklist/abc', { title: 'x' })?.op.key).toBe('checklist.update');
    expect(M.reg.matchOp('POST', '/sales/invoices', { isOfficial: true })).toBeNull();
    expect(M.reg.matchOp('POST', '/sales/invoices', { isOfficial: false })?.op.key).toBe('sales.invoice.draft.create');
    expect(M.reg.matchOp('POST', '/sales/invoices/x/confirm', {})).toBeNull();
    expect(M.reg.matchOp('POST', '/crm/contacts', {}, new Set(['tasks.create']))).toBeNull();
    expect(M.reg.isOnlineOnly('POST', '/sales/invoices/x/sign')).toBe(true);
    expect(M.reg.isOnlineOnly('POST', '/accounting/journal')).toBe(true);
    expect(M.reg.isOnlineOnly('POST', '/crm/contacts')).toBe(false);
  });
});

describe('encryption', () => {
  it('round-trips, fails with wrong key / wrong AAD, key is non-extractable', async () => {
    const k = await M.crypto.generateDataKey();
    expect(k.extractable).toBe(false);
    const s = await M.crypto.sealJson(k, { a: 'سلام' }, 'x');
    expect(await M.crypto.openJson(k, s, 'x')).toEqual({ a: 'سلام' });
    await expect(M.crypto.openJson(k, s, 'y')).rejects.toBeTruthy();
    const k2 = await M.crypto.generateDataKey();
    await expect(M.crypto.openJson(k2, s, 'x')).rejects.toBeTruthy();
  });
});

describe('sync engine', () => {
  it('sends FIFO per group with idempotency headers and survives a restart (crash safety)', async () => {
    const t = setup((c) => json(201, { id: `srv-${c.url.split('/').pop()}` }));
    const a = await t.engine.enqueue({ op: t.op('checklist.create'), method: 'POST', path: '/daily-checklist', body: { title: 'a' }, label: 'a' });
    await t.engine.enqueue({ op: t.op('checklist.create'), method: 'POST', path: '/daily-checklist', body: { title: 'b' }, label: 'b' });
    // «کرش»: موتور جدید روی همان IndexedDB
    const db2 = new M.idb.IdbDb(t.factory);
    const store2 = new M.store.OfflineStore(db2, { tenantId: 't1', userId: 'u1' });
    expect((await store2.outboxList()).length).toBe(2);
    const r = await t.engine.run();
    expect(r.synced).toBe(2);
    expect(t.calls.every((c) => /^[A-Za-z0-9_-]{16,128}$/.test(c.headers['Idempotency-Key']))).toBe(true);
    expect(t.calls[0].headers['X-Offline-Op']).toBe('checklist.create');
    expect(a.tempId).toMatch(/^tmp_/);
    expect(await t.store.outboxCounts()).toMatchObject({ done: 2, pending: 0 });
  });

  it('rewrites tmp ids in dependent items (create contact -> invoice) and orders them', async () => {
    const t = setup((c) => (c.url.endsWith('/crm/contacts') ? json(201, { id: 'REAL-C1' }) : json(201, { id: 'INV1' })));
    const c = await t.engine.enqueue({ op: t.op('crm.contact.create'), method: 'POST', path: '/crm/contacts', body: { name: 'x' }, label: 'c' });
    await t.engine.enqueue({ op: t.op('sales.invoice.draft.create'), method: 'POST', path: '/sales/invoices', body: { contactId: c.tempId, lines: [] }, label: 'i' });
    await t.engine.run();
    expect(t.calls.map((x) => x.url)).toEqual(['/api/crm/contacts', '/api/sales/invoices']);
    expect((t.calls[1].body as { contactId: string }).contactId).toBe('REAL-C1');
  });

  it('retries after a lost response with the SAME idempotency key', async () => {
    let first = true;
    const t = setup(() => {
      if (first) {
        first = false;
        throw new TypeError('network');
      }
      return json(201, { id: 'X' }, { 'Idempotency-Replayed': 'true' });
    });
    await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    await t.engine.run();
    const item = (await t.store.outboxList())[0];
    expect(item.status).toBe('pending');
    expect(item.nextTryAt).toBeGreaterThan(0);
    const key1 = t.calls[0].headers['Idempotency-Key'];
    await t.store.outboxUpdate({ ...item, nextTryAt: 0 });
    await t.engine.run();
    expect(t.calls[1].headers['Idempotency-Key']).toBe(key1);
    expect((await t.store.outboxList())[0].status).toBe('done');
  });

  it('applies exponential backoff with jitter bounds', async () => {
    expect(M.engine.backoffMs(1, () => 1)).toBe(2000);
    expect(M.engine.backoffMs(3, () => 1)).toBe(8000);
    expect(M.engine.backoffMs(3, () => 0)).toBe(4000);
    expect(M.engine.backoffMs(30, () => 1)).toBe(15 * 60_000);
  });

  it('pauses when offline without losing the queue and resumes', async () => {
    let online = false;
    const t = setup(() => json(201, { id: 'Z' }), { online: () => online });
    await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    expect((await t.engine.run()).paused).toBe('offline');
    expect(t.calls.length).toBe(0);
    online = true;
    expect((await t.engine.run()).synced).toBe(1);
  });

  it('pauses on 401 and resumes after the token changes', async () => {
    let token = 'old';
    let authed = false;
    const t = setup(() => (authed ? json(201, { id: 'K' }) : json(401, { message: 'x' })), { token: () => token });
    await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    expect((await t.engine.run()).paused).toBe('auth');
    expect((await t.store.outboxList())[0].status).toBe('pending');
    expect((await t.engine.run()).paused).toBe('auth'); // هنوز همان توکن
    expect(t.calls.length).toBe(1);
    token = 'new';
    authed = true;
    expect((await t.engine.run()).synced).toBe(1);
  });

  it('409 STALE -> conflict, blocks the group, resolve with mine re-sends with new base', async () => {
    let stale = true;
    const t = setup((_c) => (stale ? json(409, { message: 'stale', code: 'STALE', currentUpdatedAt: '2026-01-01T00:00:00.000Z' }) : json(200, { id: 'c1' })));
    await t.engine.enqueue({ op: t.op('crm.contact.update'), method: 'PUT', path: '/crm/contacts/c1', body: { name: 'mine' }, entity: 'contact:c1', label: 'e', baseUpdatedAt: '2025-12-01T00:00:00.000Z' });
    await t.engine.enqueue({ op: t.op('crm.contact.update'), method: 'PUT', path: '/crm/contacts/c1', body: { name: 'mine2' }, entity: 'contact:c1', label: 'e2' });
    await t.engine.run();
    const items = await t.store.outboxList();
    expect(items[0].status).toBe('conflict');
    expect(items[1].status).toBe('pending');
    expect(t.calls.length).toBe(1); // دومی مسدود
    expect(t.calls[0].headers['X-Base-Updated-At']).toBe('2025-12-01T00:00:00.000Z');
    stale = false;
    await t.engine.resolveConflict(items[0].id, { kind: 'mine' });
    await t.engine.run();
    expect(t.calls[1].headers['X-Base-Updated-At']).toBe('2026-01-01T00:00:00.000Z');
    expect((await t.store.outboxCounts()).done).toBe(2);
  });

  it('4xx business rejection -> failed with reason, never dropped; discard marks dependents failed', async () => {
    const t = setup(() => json(422, { message: 'قانون کسب‌وکار' }));
    const c = await t.engine.enqueue({ op: t.op('crm.contact.create'), method: 'POST', path: '/crm/contacts', body: { name: 'x' }, label: 'c' });
    await t.engine.enqueue({ op: t.op('crm.activity.add'), method: 'POST', path: `/crm/contacts/${c.tempId}/activities`, body: { note: 'n' }, label: 'n' });
    await t.engine.run();
    const items = await t.store.outboxList();
    expect(items[0]).toMatchObject({ status: 'failed', lastError: 'قانون کسب‌وکار', httpStatus: 422 });
    expect(items[1].status).toBe('pending');
    await t.engine.discard(items[0].id);
    expect((await t.store.outboxList())[0].status).toBe('failed');
  });

  it('5xx and 429 are retried, not failed', async () => {
    const t = setup(() => json(503, { message: 'down' }));
    await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    await t.engine.run();
    expect((await t.store.outboxList())[0].status).toBe('pending');
  });

  it('runs independent groups in parallel', async () => {
    let inflight = 0;
    let peak = 0;
    const t = setup(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight -= 1;
      return json(201, { id: 'p' });
    });
    for (let i = 0; i < 3; i += 1) await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: `t${i}` }, label: 't' });
    await t.engine.run();
    expect(peak).toBeGreaterThan(1);
  });

  it('requires review for items older than the policy window', async () => {
    let now = Date.parse('2026-10-01T00:00:00Z');
    const t = setup(() => json(201, { id: 'o' }), { now: () => now });
    await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    now += 9 * 86_400_000;
    await t.engine.run();
    const it = (await t.store.outboxList())[0];
    expect(it).toMatchObject({ status: 'failed', lastErrorCode: 'OFFLINE_TOO_OLD' });
    expect(t.calls.length).toBe(0);
    await t.engine.review(it.id);
    await t.engine.run();
    expect(t.calls[0].headers['X-Offline-Reviewed']).toBe('1');
  });

  it('moves large data-URIs into encrypted blobs and rehydrates on send; enforces size cap', async () => {
    const t = setup(() => json(201, { id: 'f' }));
    const big = `data:image/png;base64,${btoa('x'.repeat(12000))}`;
    const { id } = await t.engine.enqueue({ op: t.op('tasks.result'), method: 'POST', path: '/tasks/t1/result', body: { text: 'hi', files: [{ dataUrl: big }] }, label: 'r' });
    const stored = await t.store.outboxGet(id);
    expect(JSON.stringify(stored!.body)).not.toContain('base64');
    expect((await t.store.usage()).blobBytes).toBe(12000);
    await t.engine.run();
    expect((t.calls[0].body as { files: Array<{ dataUrl: string }> }).files[0].dataUrl).toBe(big);
    const small = setup(() => json(201, {}));
    const eng = new M.engine.SyncEngine({ store: small.store, apiUrl: '', getToken: () => 't', fetchImpl: fetch, isOnline: () => true, maxFileBytes: () => 100 });
    await expect(eng.enqueue({ op: small.op('tasks.result'), method: 'POST', path: '/tasks/t1/result', body: { f: big }, label: 'r' })).rejects.toBeInstanceOf(M.engine.OfflineLimitError);
  });
});

describe('store isolation, cache and wipe', () => {
  it('another user in the same browser cannot list or flush the outbox', async () => {
    const factory = new IDBFactory();
    const a = setup(() => json(201, { id: '1' }), { factory, user: 'alice' });
    await a.engine.enqueue({ op: a.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 'secret' }, label: 'x' });
    const b = setup(() => json(201, { id: '1' }), { factory, user: 'bob' });
    expect(await b.store.outboxList()).toEqual([]);
    expect((await b.engine.run()).synced).toBe(0);
    expect(b.calls.length).toBe(0);
    expect((await a.store.outboxList()).length).toBe(1);
  });

  it('ciphertext does not contain plaintext', async () => {
    const t = setup(() => json(201, {}));
    await t.engine.enqueue({ op: t.op('crm.contact.create'), method: 'POST', path: '/crm/contacts', body: { name: 'محرمانه-XYZ' }, label: 'محرمانه-XYZ' });
    const raw = await t.db.tx(['outbox'], 'readonly', (s) => s.outbox.getAll<{ ct: ArrayBuffer }>());
    // group (شناسه‌ی رکورد/کارمند) و opKey متن‌ساده روی ردیف نمی‌ماند
    expect(Object.keys(raw[0]).sort()).toEqual(['attempts', 'createdAtDevice', 'ct', 'id', 'iv', 'nextTryAt', 'scope', 'seq', 'status', 'v']);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(raw[0].ct);
    expect(text).not.toContain('XYZ');
  });

  it('wipe(keepOutbox) clears cache only; wipe() destroys key and outbox', async () => {
    const t = setup(() => json(201, {}));
    await t.engine.enqueue({ op: t.op('tasks.create'), method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    await t.store.cachePut('k', { a: 1 }, { entity: 'x', ttlMs: 1000 });
    await t.store.wipe({ keepOutbox: true });
    expect(await t.store.cacheGet('k', true)).toBeNull();
    expect((await t.store.outboxList()).length).toBe(1);
    await t.store.wipe({ keepOutbox: false });
    expect((await t.store.outboxList()).length).toBe(0);
    expect(await t.store.hasKey()).toBe(false);
  });

  it('cache TTL, stale-on-offline, LRU/quota eviction never touches the outbox', async () => {
    let now = 1_000_000;
    const factory = new IDBFactory();
    const store = new M.store.OfflineStore(new M.idb.IdbDb(factory), { tenantId: 't', userId: 'u' }, globalThis.crypto, () => now);
    const engine = new M.engine.SyncEngine({ store, apiUrl: '', getToken: () => 't', fetchImpl: fetch, isOnline: () => true, now: () => now });
    await engine.enqueue({ op: M.reg.OFFLINE_OPS.find((o) => o.key === 'tasks.create')!, method: 'POST', path: '/tasks', body: { title: 't' }, label: 't' });
    await store.cachePut('a', 'x'.repeat(1000), { entity: 'e', ttlMs: 100 });
    now += 10;
    await store.cachePut('b', 'y'.repeat(1000), { entity: 'e', ttlMs: 100 });
    now += 10;
    await store.cachePut('c', 'z'.repeat(1000), { entity: 'e', ttlMs: 100 });
    now += 500;
    expect(await store.cacheGet('a')).toBeNull(); // منقضی
    expect((await store.cacheGet('a', true))?.stale).toBe(true); // آفلاین
    now += 10;
    await store.cacheGet('c', true); // c تازه‌ترین دسترسی
    await new Promise((r) => setTimeout(r, 20));
    const removed = await store.cacheEvict({ maxBytes: 1, maxEntries: 1, maxAgeMs: 1e9 });
    expect(removed).toBeGreaterThanOrEqual(2);
    expect((await store.outboxList()).length).toBe(1);
  });
});

describe('lookups, overlay, local search, identity', () => {
  it('mergeDelta: delta upserts, full replaces, ids prune deletions, cap keeps newest', async () => {
    const L = await load<typeof import('../../../web-panel/src/lib/offline/lookups')>('lookups');
    const a = { id: 'a', updatedAt: '2026-01-01' };
    const b = { id: 'b', updatedAt: '2026-01-02' };
    expect(L.mergeDelta([a, b], { mode: 'delta', items: [{ id: 'a', updatedAt: '2026-01-05' }], nextSince: null, truncated: false }, 10).map((r) => r.id)).toEqual(['a', 'b']);
    expect(L.mergeDelta([a, b], { mode: 'full', items: [a], nextSince: null, truncated: false }, 10)).toEqual([a]);
    expect(L.mergeDelta([a, b], { mode: 'delta', items: [], nextSince: null, truncated: false, ids: ['b'] }, 10)).toEqual([b]);
    expect(L.mergeDelta([a, b], { mode: 'delta', items: [], nextSince: null, truncated: false }, 1)).toEqual([b]);
  });
  it('local contact search normalises Persian digits and honours kind', () => {
    const rows = [
      { id: '1', name: 'علی رضایی', company: null, phone: '09121234567', type: 'INDIVIDUAL' as const, isCustomer: true, isSupplier: false, updatedAt: 'x' },
      { id: '2', name: 'شرکت ب', company: 'ب', phone: null, type: 'COMPANY' as const, isCustomer: false, isSupplier: true, updatedAt: 'x' },
    ];
    expect(M.reg.searchContactsLocal(rows, new URLSearchParams({ q: '۰۹۱۲۱' })).map((r) => r.id)).toEqual(['1']);
    expect(M.reg.searchContactsLocal(rows, new URLSearchParams({ kind: 'supplier' })).map((r) => r.id)).toEqual(['2']);
  });
  it('overlay shows queued checklist items and toggles', async () => {
    const O = await load<typeof import('../../../web-panel/src/lib/offline/overlay')>('overlay');
    const items = [
      { opKey: 'checklist.create', status: 'pending', tempId: 'tmp_1', id: 'i1', body: { title: 'نو', date: '2026-10-24' }, path: '/daily-checklist', createdAtDevice: 'z' },
      { opKey: 'checklist.toggle', status: 'pending', id: 'i2', body: { done: true }, path: '/daily-checklist/c1', createdAtDevice: 'z' },
    ] as never;
    const out = O.applyOverlay('checklist', [{ id: 'c1', done: false }], items, new URLSearchParams({ date: '2026-10-24' })) as Array<Record<string, unknown>>;
    expect(out.find((r) => r.id === 'c1')).toMatchObject({ done: true, _queued: true });
    expect(out.find((r) => r.id === 'tmp_1')).toMatchObject({ title: 'نو', _queued: true });
  });
  it('identity comes from the JWT without network and rejects non-tenant tokens', async () => {
    const I = await load<typeof import('../../../web-panel/src/lib/offline/identity')>('identity');
    const mk = (p: object) => `h.${Buffer.from(JSON.stringify(p)).toString('base64url')}.s`;
    expect(I.identityFromToken(mk({ type: 'tenant_user', sub: 'u', tenantId: 't' }))).toEqual({ tenantId: 't', userId: 'u' });
    expect(I.identityFromToken(mk({ type: 'admin', sub: 'u' }))).toBeNull();
    expect(I.identityFromToken('garbage')).toBeNull();
  });
  it('tmp id helpers find and rewrite nested references only', () => {
    const body = { contactId: 'tmp_abcdef12-aaaa', lines: [{ note: 'x tmp_abcdef12-aaaa y' }], file: 'data:image/png;base64,tmp_abcdef12-aaaa' };
    expect([...M.engine.findTmpIds(body)]).toEqual(['tmp_abcdef12-aaaa']);
    const out = M.engine.replaceTmp(body, { 'tmp_abcdef12-aaaa': 'REAL' });
    expect(out.contactId).toBe('REAL');
    expect(out.lines[0].note).toBe('x REAL y');
    expect(out.file).toContain('tmp_abcdef12-aaaa');
  });
});
