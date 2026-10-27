import { describe, expect, it, vi } from 'vitest';
import { of, lastValueFrom, throwError } from 'rxjs';
import {
  beginIdempotent, clampOfflineCreatedAt, hashRequest, IDEMPOTENCY_TTL_MS, packResponse, parseIdempotencyKey, parseOfflineMeta, PENDING_TIMEOUT_MS,
  stableStringify, type ClaimInput, type IdemRecord, type IdempotencyStore,
} from './idempotency.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { isStale, matchStaleRule, parseBaseUpdatedAt } from './stale-check.js';
import { defaultPolicy, mergeStoredPolicy, OFFLINE_OPERATION_KEYS, roleAllowed, validatePolicyInput } from './sync-policy.js';
import { buildChangesResult, cursorWhere, parseChangesQuery, parseCursor } from './sync-changes.js';
import { canStoreResponseBody, matchServerOp, SERVER_OP_KEYS } from './server-ops.js';

/** ذخیره‌گاه حافظه با همان قرارداد یکتایی (userId,key) */
class MemStore implements IdempotencyStore {
  rows = new Map<string, IdemRecord>();
  seq = 0;
  private k = (u: string, key: string) => `${u}|${key}`;
  async claim(i: ClaimInput) {
    const ex = this.rows.get(this.k(i.userId, i.key));
    if (ex) return { claimed: false as const, existing: ex };
    const rec: IdemRecord = { id: `r${(this.seq += 1)}`, userId: i.userId, key: i.key, method: i.method, path: i.path, requestHash: i.requestHash, status: 'PENDING', responseStatus: null, responseBody: null, resourceId: null, createdAt: i.now, expiresAt: new Date(i.now.getTime() + IDEMPOTENCY_TTL_MS) };
    this.rows.set(this.k(i.userId, i.key), rec);
    return { claimed: true as const, id: rec.id };
  }
  async complete(id: string, d: { responseStatus: number; responseBody: unknown; resourceId: string | null }) {
    if (this.failComplete) throw new Error('db down');
    for (const r of this.rows.values()) if (r.id === id) Object.assign(r, { status: 'DONE', ...d });
  }
  async release(id: string) {
    for (const [k, r] of this.rows) if (r.id === id && r.status === 'PENDING') this.rows.delete(k);
  }
  async countForUser(userId: string) {
    return [...this.rows.values()].filter((r) => r.userId === userId).length;
  }
  failComplete = false;
  async markUnknown(id: string) {
    for (const r of this.rows.values()) if (r.id === id) r.status = 'UNKNOWN';
  }
  async evict(id: string) {
    for (const [k, r] of this.rows) if (r.id === id) return this.rows.delete(k);
    return false;
  }
}

const now = new Date('2026-10-24T10:00:00Z');
const input = (over: Partial<ClaimInput> = {}): ClaimInput => ({ userId: 'u1', key: 'k'.repeat(20), method: 'POST', path: '/tasks', requestHash: 'h1', offlineCreatedAt: null, now, ...over });

describe('pure helpers', () => {
  it('validates keys', () => {
    expect(parseIdempotencyKey('a'.repeat(16))).toBeTruthy();
    expect(parseIdempotencyKey('short')).toBeNull();
    expect(parseIdempotencyKey('a b'.repeat(8))).toBeNull();
    expect(parseIdempotencyKey(['x'])).toBeNull();
  });
  it('hash is order independent and body sensitive', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(hashRequest('POST', '/x', { a: 1, b: 2 })).toBe(hashRequest('POST', '/x', { b: 2, a: 1 }));
    expect(hashRequest('POST', '/x', { a: 1 })).not.toBe(hashRequest('POST', '/x', { a: 2 }));
    expect(hashRequest('POST', '/x', {})).not.toBe(hashRequest('PUT', '/x', {}));
  });
  it('clamps device time', () => {
    const t = Date.parse('2026-10-24T10:00:00Z');
    expect(clampOfflineCreatedAt('not a date', t)).toEqual({ ok: false, reason: 'invalid' });
    expect(clampOfflineCreatedAt('2020-01-01T00:00:00Z', t)).toEqual({ ok: false, reason: 'tooOld' });
    expect(clampOfflineCreatedAt('2026-10-01T00:00:00Z', t, 7 * 86_400_000)).toEqual({ ok: false, reason: 'tooOld' });
    expect(clampOfflineCreatedAt('2030-01-01T00:00:00Z', t)).toMatchObject({ ok: true, at: new Date(t) });
    expect(clampOfflineCreatedAt('2026-10-23T10:00:00Z', t)).toMatchObject({ ok: true });
    expect(parseOfflineMeta({ 'x-offline-device': 'Android Chrome', 'x-client-time': new Date(t + 5000).toISOString() }, t)).toMatchObject({ device: 'Android Chrome', skewMs: 5000 });
    expect(parseOfflineMeta({ 'x-offline-device': '<script>' }, t)).toBeNull();
  });
  it('packs responses: small kept, large reduced to id', () => {
    expect(packResponse({ id: 'abc', x: 1 })).toEqual({ body: { id: 'abc', x: 1 }, resourceId: 'abc' });
    const big = packResponse({ id: 'abc', blob: 'x'.repeat(40_000) });
    expect(big.resourceId).toBe('abc');
    expect(JSON.stringify(big.body)).not.toContain('xxxx');
    expect(packResponse(Buffer.from('x')).body).toBeNull();
  });
});

describe('beginIdempotent', () => {
  it('first claim proceeds; replay returns stored response; mismatch -> reused; in-progress', async () => {
    const s = new MemStore();
    const a = await beginIdempotent(s, input());
    expect(a.kind).toBe('proceed');
    expect((await beginIdempotent(s, input())).kind).toBe('in-progress');
    await s.complete((a as { id: string }).id, { responseStatus: 201, responseBody: { id: 'n1' }, resourceId: 'n1' });
    expect(await beginIdempotent(s, input())).toEqual({ kind: 'replay', status: 201, body: { id: 'n1' } });
    expect((await beginIdempotent(s, input({ requestHash: 'other' }))).kind).toBe('reused');
  });
  it('is scoped by user: same key from another user is independent', async () => {
    const s = new MemStore();
    await beginIdempotent(s, input());
    expect((await beginIdempotent(s, input({ userId: 'u2' }))).kind).toBe('proceed');
  });
  it('concurrent same key: exactly one proceeds', async () => {
    const s = new MemStore();
    const rs = await Promise.all(Array.from({ length: 10 }, () => beginIdempotent(s, input())));
    expect(rs.filter((r) => r.kind === 'proceed').length).toBe(1);
    expect(rs.filter((r) => r.kind === 'in-progress').length).toBe(9);
  });
  it('takes over a stale PENDING row (crashed process) and expired rows', async () => {
    const s = new MemStore();
    await beginIdempotent(s, input());
    const later = new Date(now.getTime() + PENDING_TIMEOUT_MS + 1000);
    expect((await beginIdempotent(s, input({ now: later }))).kind).toBe('proceed');
    const s2 = new MemStore();
    const a = await beginIdempotent(s2, input());
    await s2.complete((a as { id: string }).id, { responseStatus: 200, responseBody: null, resourceId: null });
    const expired = new Date(now.getTime() + IDEMPOTENCY_TTL_MS + 1000);
    expect((await beginIdempotent(s2, input({ now: expired }))).kind).toBe('proceed');
  });
});

// ── Interceptor (با ماژول فعال/غیرفعال) ──
function makeInterceptor(moduleOn: boolean, store: MemStore, policy = defaultPolicy(), canEdit = true) {
  const control = {
    moduleDefinition: { findMany: async () => [{ id: 'm1', code: 'offline-sync', isCore: false, dependsOn: [] }] },
    tenantModule: { findMany: async () => (moduleOn ? [{ moduleId: 'm1', status: 'INSTALLED' }] : []) },
  };
  const ic = new IdempotencyInterceptor(control as never, { forTenant: () => store } as never, { get: async () => policy } as never, { getEffective: async () => ({ canEdit }) } as never);
  return ic;
}
function exec(headers: Record<string, string>, over: { method?: string; body?: unknown; userId?: string; role?: string; path?: string } = {}) {
  const resHeaders: Record<string, string> = {};
  const req = {
    method: over.method ?? 'POST', headers, body: over.body ?? { a: 1 }, path: over.path ?? '/api/tasks', originalUrl: over.path ?? '/api/tasks',
    ctx: { tenantId: 't1', auth: { sub: over.userId ?? 'u1', role: over.role ?? 'MEMBER' }, tenantDb: { task: { findUnique: async () => ({ updatedAt: new Date('2026-02-01T00:00:00Z') }) } } },
  };
  const res = { statusCode: 201, setHeader: (k: string, v: string) => (resHeaders[k] = v) };
  const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  return { context: context as never, req, resHeaders };
}
const key = 'a'.repeat(24);

describe('IdempotencyInterceptor', () => {
  it('ignores headers entirely when the module is not installed', async () => {
    const store = new MemStore();
    const h = vi.fn(() => of({ id: 'x' }));
    const { context, resHeaders } = exec({ 'idempotency-key': key });
    const out = await lastValueFrom(await makeInterceptor(false, store).intercept(context, { handle: h }));
    expect(out).toEqual({ id: 'x' });
    expect(store.rows.size).toBe(0);
    expect(resHeaders['X-Server-Time']).toBeUndefined();
  });
  it('executes once, replays with Idempotency-Replayed, never runs the handler twice', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    const h = vi.fn(() => of({ id: 'created-1' }));
    const first = exec({ 'idempotency-key': key });
    expect(await lastValueFrom(await ic.intercept(first.context, { handle: h }))).toEqual({ id: 'created-1' });
    const second = exec({ 'idempotency-key': key });
    expect(await lastValueFrom(await ic.intercept(second.context, { handle: h }))).toEqual({ id: 'created-1' });
    expect(h).toHaveBeenCalledTimes(1);
    expect(second.resHeaders['Idempotency-Replayed']).toBe('true');
  });
  it('same key + different body -> 422; other user same key -> runs separately', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    const h = () => of({ id: 'z' });
    await lastValueFrom(await ic.intercept(exec({ 'idempotency-key': key }).context, { handle: h }));
    await expect(ic.intercept(exec({ 'idempotency-key': key }, { body: { a: 2 } }).context, { handle: h })).rejects.toMatchObject({ status: 422 });
    const other = vi.fn(() => of({ id: 'other' }));
    await lastValueFrom(await ic.intercept(exec({ 'idempotency-key': key }, { userId: 'u2' }).context, { handle: other }));
    expect(other).toHaveBeenCalledTimes(1);
  });
  it('concurrent duplicates: second gets 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    const slow = { handle: () => new (require('rxjs').Observable)(() => undefined) };
    void ic.intercept(exec({ 'idempotency-key': key }).context, slow as never).then((o) => o.subscribe());
    await new Promise((r) => setTimeout(r, 5));
    await expect(ic.intercept(exec({ 'idempotency-key': key }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 409 });
  });
  it('handler error releases the key so a retry can re-execute', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    await expect(lastValueFrom(await ic.intercept(exec({ 'idempotency-key': key }).context, { handle: () => throwError(() => new Error('boom')) }))).rejects.toThrow('boom');
    expect(store.rows.size).toBe(0);
    const h = vi.fn(() => of({ id: 'ok' }));
    await lastValueFrom(await ic.intercept(exec({ 'idempotency-key': key }).context, { handle: h }));
    expect(h).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed keys', async () => {
    await expect(makeInterceptor(true, new MemStore()).intercept(exec({ 'idempotency-key': 'bad key!' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 400 });
  });
  it('STALE: 409 when server record is newer than X-Base-Updated-At, releases claim; fresh base passes', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    const stale = exec({ 'idempotency-key': key, 'x-base-updated-at': '2026-01-01T00:00:00Z' }, { method: 'PATCH', path: '/api/tasks/abc' });
    const err = await ic.intercept(stale.context, { handle: () => of({}) }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.response.code).toBe('STALE');
    expect(JSON.stringify(err.response)).not.toContain('currentUpdatedAt');
    expect(store.rows.size).toBe(0);
    // بدون مجوز ویرایش: هیچ نشانه‌ای از وجود/تغییر رکورد داده نمی‌شود (بررسی STALE انجام نمی‌شود)
    const noPerm = makeInterceptor(true, new MemStore(), defaultPolicy(), false);
    const stale2 = exec({ 'idempotency-key': key, 'x-base-updated-at': '2026-01-01T00:00:00Z' }, { method: 'PATCH', path: '/api/tasks/abc' });
    expect(await lastValueFrom(await noPerm.intercept(stale2.context, { handle: () => of({ id: 'abc' }) }))).toEqual({ id: 'abc' });
    const fresh = exec({ 'idempotency-key': key, 'x-base-updated-at': '2026-02-01T00:00:00Z' }, { method: 'PATCH', path: '/api/tasks/abc' });
    expect(await lastValueFrom(await ic.intercept(fresh.context, { handle: () => of({ id: 'abc' }) }))).toEqual({ id: 'abc' });
  });
  it('enforces policy: role, disabled op, too old without review', async () => {
    const store = new MemStore();
    const recent = new Date().toISOString();
    const roleBlock = makeInterceptor(true, store, { ...defaultPolicy(), allowedRoles: ['OWNER'] });
    await expect(roleBlock.intercept(exec({ 'x-offline-created-at': recent }, { role: 'MEMBER' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 403 });
    const opBlock = makeInterceptor(true, store, { ...defaultPolicy(), enabledOperations: ['tasks.create'] });
    // op از مسیر واقعی تعیین می‌شود؛ هدر X-Offline-Op (حتی اگر tasks.create بگوید) فریب نمی‌دهد
    await expect(opBlock.intercept(exec({ 'x-offline-created-at': recent, 'x-offline-op': 'tasks.create' }, { path: '/api/crm/contacts' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 403 });
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const ic = makeInterceptor(true, store);
    await expect(ic.intercept(exec({ 'x-offline-created-at': old, 'x-offline-op': 'tasks.create' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    // هدر Reviewed به‌تنهایی سن را دور نمی‌زند (حتی برای مدیر، مگر سیاست allowReviewedBeyondMax)
    const hdr = { 'x-offline-created-at': old, 'x-offline-reviewed': '1' };
    await expect(ic.intercept(exec(hdr).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    await expect(ic.intercept(exec(hdr, { role: 'OWNER' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    const lenient = makeInterceptor(true, store, { ...defaultPolicy(), allowReviewedBeyondMax: true });
    await expect(ic.intercept(exec(hdr, { role: 'MEMBER' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    await expect(lenient.intercept(exec(hdr, { role: 'MEMBER' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    await expect(lastValueFrom(await lenient.intercept(exec(hdr, { role: 'OWNER' }).context, { handle: () => of({ ok: 1 }) }))).resolves.toEqual({ ok: 1 });
  });
  it('invalid/absent device date or non-registry path with offline headers is rejected', async () => {
    const ic = makeInterceptor(true, new MemStore());
    await expect(ic.intercept(exec({ 'x-offline-created-at': 'garbage' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    await expect(ic.intercept(exec({ 'x-offline-op': 'tasks.create' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 422 });
    await expect(ic.intercept(exec({ 'x-offline-created-at': new Date().toISOString() }, { path: '/api/settings/webhooks' }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 403 });
    // سند رسمی آفلاین نمی‌شود
    await expect(ic.intercept(exec({ 'x-offline-created-at': new Date().toISOString() }, { path: '/api/sales/invoices', body: { isOfficial: true } }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 403 });
  });
  it('never stores response bodies outside registry paths (settings/**, api-keys...) — only status + id', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    await lastValueFrom(await ic.intercept(exec({ 'idempotency-key': key }, { path: '/api/settings/webhooks' }).context, { handle: () => of({ id: 'w1', secret: 'whsec_TOPSECRET' }) }));
    const row = [...store.rows.values()][0];
    expect(JSON.stringify(row.responseBody)).not.toContain('TOPSECRET');
    expect(row.resourceId).toBe('w1');
    const again = exec({ 'idempotency-key': key }, { path: '/api/settings/webhooks' });
    expect(await lastValueFrom(await ic.intercept(again.context, { handle: () => of({}) }))).toEqual({ id: 'w1', idempotentReplay: true });
  });
  it('registry paths keep the body for replay', async () => {
    const store = new MemStore();
    const ic = makeInterceptor(true, store);
    await lastValueFrom(await ic.intercept(exec({ 'idempotency-key': key }).context, { handle: () => of({ id: 't1', title: 'x' }) }));
    expect([...store.rows.values()][0].responseBody).toEqual({ id: 't1', title: 'x' });
  });
  it('quota per user -> 429; complete failure -> UNKNOWN -> 409 not re-executed', async () => {
    const store = new MemStore();
    for (let i = 0; i < 5000; i += 1) await store.claim(input({ key: `q${i}`.padEnd(20, '_') }));
    const ic = makeInterceptor(true, store);
    await expect(ic.intercept(exec({ 'idempotency-key': key }).context, { handle: () => of({}) })).rejects.toMatchObject({ status: 429 });
    const s2 = new MemStore();
    s2.failComplete = true;
    const ic2 = makeInterceptor(true, s2);
    await lastValueFrom(await ic2.intercept(exec({ 'idempotency-key': key }).context, { handle: () => of({ id: 'z' }) }));
    const h = vi.fn(() => of({}));
    await expect(ic2.intercept(exec({ 'idempotency-key': key }).context, { handle: h })).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'IDEMPOTENCY_RESULT_UNKNOWN' }) });
    expect(h).not.toHaveBeenCalled();
  });
});

describe('stale rules', () => {
  it('matches only registered update routes', () => {
    expect(matchStaleRule('PUT', '/api/crm/contacts/abc')).toEqual({ model: 'crmContact', id: 'abc' });
    expect(matchStaleRule('PATCH', '/tasks/x1')).toEqual({ model: 'task', id: 'x1' });
    expect(matchStaleRule('PATCH', '/daily-checklist/x1')?.model).toBe('dailyChecklistItem');
    expect(matchStaleRule('POST', '/tasks/x1')).toBeNull();
    expect(matchStaleRule('PATCH', '/tasks/x1/start')).toBeNull();
  });
  it('compares at ms precision', () => {
    const base = parseBaseUpdatedAt('2026-01-01T00:00:00.000Z')!;
    expect(isStale(new Date('2026-01-01T00:00:00.000Z'), base)).toBe(false);
    expect(isStale(new Date('2026-01-01T00:00:00.001Z'), base)).toBe(true);
    expect(parseBaseUpdatedAt('garbage')).toBeNull();
  });
});

describe('policy validation', () => {
  it('accepts valid, rejects unknown fields / ops / ranges', () => {
    expect(validatePolicyInput({ maxOfflineDays: 3, enabledOperations: ['tasks.create'] }).maxOfflineDays).toBe(3);
    expect(() => validatePolicyInput({ evil: 1 })).toThrow();
    expect(() => validatePolicyInput({ enabledOperations: ['nope'] })).toThrow();
    expect(() => validatePolicyInput({ maxOfflineDays: 0 })).toThrow();
    expect(() => validatePolicyInput({ maxAttachmentMb: 500 })).toThrow();
    expect(() => validatePolicyInput({ allowedRoles: ['GOD'] })).toThrow();
    expect(() => validatePolicyInput('x')).toThrow();
  });
  it('merges stored policy with defaults and survives garbage', () => {
    expect(mergeStoredPolicy(null)).toEqual(defaultPolicy());
    expect(defaultPolicy().wipeOnLogout).toBe(true);
    expect(defaultPolicy().allowReviewedBeyondMax).toBe(false);
    expect(mergeStoredPolicy({ maxOfflineDays: 99999 })).toEqual(defaultPolicy());
    expect(roleAllowed(defaultPolicy(), 'MEMBER')).toBe(true);
    expect(roleAllowed({ ...defaultPolicy(), allowedRoles: ['OWNER'] }, 'MEMBER')).toBe(false);
  });
});

describe('delta endpoint helpers', () => {
  it('parses query safely and builds results with truncation', () => {
    const q = parseChangesQuery({ entities: 'contacts,evil,products', since: '2026-01-01T00:00:00Z', limit: '99999', withIds: '1' });
    expect(q.entities).toEqual(['contacts', 'products']);
    expect(q.limit).toBe(2000);
    expect(q.withIds).toBe(true);
    expect(parseChangesQuery({ since: 'bad' }).since).toBeNull();
    const rows = [1, 2, 3].map((n) => ({ id: `i${n}`, updatedAt: new Date(2026, 0, n) }));
    const r = buildChangesResult(rows, { ...q, limit: 2 });
    expect(r.truncated).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.mode).toBe('delta');
    expect(r.nextSince).toBe(`${rows[1].updatedAt.toISOString()}|i2`);
  });
});

describe('delta cursor tie-break', () => {
  it('parses ISO and ISO|id cursors and builds a composite where', () => {
    expect(cursorWhere(null)).toEqual({});
    const c1 = parseCursor('2026-01-01T00:00:00.000Z')!;
    expect(cursorWhere(c1)).toEqual({ updatedAt: { gt: c1.at } });
    const c2 = parseCursor('2026-01-01T00:00:00.000Z|abc-1')!;
    expect(c2.id).toBe('abc-1');
    expect(cursorWhere(c2)).toEqual({ OR: [{ updatedAt: { gt: c2.at } }, { updatedAt: c2.at, id: { gt: 'abc-1' } }] });
    expect(parseCursor('x|y')).toBeNull();
    expect(parseCursor('2026-01-01T00:00:00Z|bad id!')!.id).toBeNull();
  });
});

describe('server ops mapping', () => {
  it('server-side op keys equal the policy keys; op derived from path+method+body', () => {
    expect([...SERVER_OP_KEYS].sort()).toEqual([...OFFLINE_OPERATION_KEYS].sort());
    expect(matchServerOp('PATCH', '/api/daily-checklist/a', { done: true })).toBe('checklist.toggle');
    expect(matchServerOp('PATCH', '/api/daily-checklist/a', { title: 'x' })).toBe('checklist.update');
    expect(matchServerOp('POST', '/api/sales/invoices', { isOfficial: true })).toBeNull();
    expect(matchServerOp('POST', '/api/settings/webhooks', {})).toBeNull();
    expect(canStoreResponseBody('POST', '/api/settings/webhooks')).toBe(false);
    expect(canStoreResponseBody('POST', '/api/tasks')).toBe(true);
  });
});

describe('registry parity (web registry vs server policy keys)', () => {
  it('web OFFLINE_OPS keys equal OFFLINE_OPERATION_KEYS', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../../web-panel/src/lib/offline/registry.ts'), 'utf8');
    const web = [...src.matchAll(/^\s{4}key: "([a-z.-]+)",/gm)].map((m) => m[1]).sort();
    expect(web).toEqual([...OFFLINE_OPERATION_KEYS].sort());
  });
});
