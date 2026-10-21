import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CorrespondenceWorkflowService, canonicalLetterContent } from './correspondence-workflow.service.js';
import { CorrespondenceReferralsService } from './correspondence-referrals.service.js';
import { CorrespondenceLettersService, normalizeSenderKey } from './correspondence-letters.service.js';
import { CorrespondencePublicService, FixedWindowLimiter } from './correspondence-public.js';
import { deriveVerifyToken, hashVerifyToken, isWellFormedToken } from './verify-token.js';
import type { CorrActor } from './correspondence-core.service.js';

const FULL = { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: true };
const actor = (over: Partial<CorrActor> = {}): CorrActor => ({
  userId: 'signer', name: 'مدیر عامل', title: 'مدیرعامل', isOwner: false, isAdmin: false, isManager: false, matrix: FULL,
  scope: { userId: 'signer', isOwner: false, isAdmin: false, viewAll: true, viewOwn: true }, ...over,
});

function makeLetter(over: Record<string, unknown> = {}) {
  return {
    id: 'L1', type: 'OUTGOING', status: 'PENDING_SIGNATURE', subject: 'موضوع', bodyHtml: '<p>متن</p>', bodyText: 'متن', recipients: [{ name: 'شرکت الف' }],
    ccNames: [], categoryId: null, priority: 'NORMAL', confidentiality: 'NORMAL', replyToLetterId: null, attachmentsText: null, letterNumber: null,
    createdByUserId: 'author', createdByName: 'نویسنده', ownerUserId: 'author', signerUserId: 'signer', letterDate: null, issuedAt: null, archivedAt: null,
    letterheadId: null, ...over,
  };
}

// ───────────────────────────── signing ─────────────────────────────
function signHarness(opts: { renderFails?: number; letter?: Record<string, unknown> } = {}) {
  const store = { letter: makeLetter(opts.letter) as Record<string, unknown>, attachments: [] as Record<string, unknown>[], events: [] as string[] };
  let renderFailures = opts.renderFails ?? 0;
  const tx = {
    corrLetter: {
      findUniqueOrThrow: vi.fn(async () => ({ ...store.letter })),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.status && store.letter.status !== where.status) return { count: 0 };
        if ('letterNumber' in where && where.letterNumber === null && store.letter.letterNumber) return { count: 0 };
        Object.assign(store.letter, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(store.letter, data)),
    },
    attachment: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const a = { id: 'ATT1', ...data }; store.attachments.push(a); return a; }) },
  };
  const tenantDb = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    corrParaph: { findMany: vi.fn(async () => [{ authorName: 'پاراف‌زن', authorTitle: null, text: 'بررسی شود', order: 1, createdAt: new Date() }]) },
    attachment: { findMany: vi.fn(async () => [{ id: 'A1', title: 'ضمیمه' }]) },
  };
  const core = {
    findVisible: vi.fn(async () => ({ ...store.letter })),
    userBrief: vi.fn(async () => ({ name: 'مدیر عامل', title: 'مدیرعامل' })),
    addParticipant: vi.fn(async () => undefined),
    logEvent: vi.fn(async (_db: unknown, _id: string, type: string) => { store.events.push(type); }),
    notify: vi.fn(async () => undefined),
  };
  let seq = 0;
  const numbering = { issue: vi.fn(async () => ({ number: `ص/1405/${String(++seq).padStart(5, '0')}`, schemeId: 's', periodKey: '1405', seq })) };
  const pdf = Buffer.from('%PDF-1.4 fake');
  const render = {
    build: vi.fn(async (_c: unknown, l: Record<string, unknown>) => ({ number: l.letterNumber, signature: { imageDataUri: null } })),
    render: vi.fn(async () => { if (renderFailures-- > 0) throw new Error('chromium down'); return pdf; }),
  };
  const evidence = { tryRecord: vi.fn(async () => ({})) };
  const stamps = { assertCanUse: vi.fn(async () => undefined) };
  const svc = new CorrespondenceWorkflowService(core as never, numbering as never, render as never, evidence as never, stamps as never, { resolve: async () => ({ fields: { signerTitle: '', orgName: '', signerName: 'n', honorific: '', showDate: true }, titleLine: 'T', nameLine: 'N', showDate: true }) } as never);
  const ctx = { tenantId: 't1', tenantSlug: 'acme', tenantDb, auth: { role: 'MEMBER' } } as never;
  return { svc, ctx, store, core, numbering, render, evidence, tenantDb, pdf, stamps };
}

describe('sign flow', () => {
  const req = { headers: { 'user-agent': 'x' } } as never;

  it('assigns the number, stores an immutable PDF snapshot with sha256, records evidence and flips to ISSUED', async () => {
    const h = signHarness();
    const out = await h.svc.sign(h.ctx, actor(), 'L1', { confirm: true }, req);
    expect(out.status).toBe('ISSUED');
    expect(out.letterNumber).toBe('ص/1405/00001');
    expect(h.numbering.issue).toHaveBeenCalledTimes(1);
    expect(h.store.attachments).toHaveLength(1);
    expect(h.store.attachments[0]).toMatchObject({ entityType: 'LetterSnapshot', entityId: 'L1' });
    expect(String(h.store.attachments[0].fileUrl).startsWith('data:application/pdf;base64,')).toBe(true);
    expect(out.pdfSnapshotSha256).toBe(createHash('sha256').update(h.pdf).digest('hex'));
    expect(out.pdfSnapshotAttachmentId).toBe('ATT1');
    expect(out.verifyTokenHash).toBe(hashVerifyToken(deriveVerifyToken('t1', 'L1')));
    expect(h.store.events).toEqual(expect.arrayContaining(['SIGNED', 'ISSUED']));
    // مدرک امضا
    expect(h.evidence.tryRecord).toHaveBeenCalledTimes(1);
    const ev = (h.evidence.tryRecord.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(ev).toMatchObject({ entityType: 'correspondence_letter', entityId: 'L1', action: 'sign', signerUserId: 'signer' });
    expect(out.contentHash).toBe(ev.contentHash);
    expect(String(ev.contentHash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('freezes the signature block (fields + both lines) into the letter at signing time and into the content hash', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    const h = signHarness({ letter: { signatureBlock: { signerTitle: 'ویرایش‌شده' } } });
    const out = await h.svc.sign(h.ctx, actor(), 'L1', { confirm: true }, req);
    expect(out.signatureBlock).toMatchObject({ signerName: 'n', titleLine: 'T', nameLine: 'N', showDate: true });
    const ev = (h.evidence.tryRecord.mock.calls[0] as unknown[])[1] as { contentHash: string };
    const h2 = signHarness({ letter: { signatureBlock: { signerTitle: 'ویرایش‌شده' } } });
    (h2.svc as unknown as { signatures: { resolve: unknown } }).signatures.resolve = async () => ({ fields: { signerTitle: 'x', orgName: '', signerName: 'n', honorific: '', showDate: true }, titleLine: 'متن دیگر', nameLine: 'N', showDate: true });
    await h2.svc.sign(h2.ctx, actor(), 'L1', { confirm: true }, req);
    vi.useRealTimers();
    expect(((h2.evidence.tryRecord.mock.calls[0] as unknown[])[1] as { contentHash: string }).contentHash).not.toBe(ev.contentHash);
  });

  it('requires explicit confirmation and the designated signer', async () => {
    const h = signHarness();
    await expect(h.svc.sign(h.ctx, actor(), 'L1', { confirm: false }, req)).rejects.toThrow(/تأیید/);
    await expect(h.svc.sign(h.ctx, actor({ userId: 'other' }), 'L1', { confirm: true }, req)).rejects.toThrow(/امضاکننده/);
    expect(h.numbering.issue).not.toHaveBeenCalled();
    // مالک می‌تواند به‌جای امضاکننده امضا کند
    const ok = await h.svc.sign(h.ctx, actor({ userId: 'boss', isOwner: true, isManager: true }), 'L1', { confirm: true }, req);
    expect(ok.status).toBe('ISSUED');
  });

  it('rejects signing in the wrong state and never double-issues a number', async () => {
    const h = signHarness({ letter: { status: 'DRAFT' } });
    await expect(h.svc.sign(h.ctx, actor(), 'L1', { confirm: true }, req)).rejects.toThrow();
    expect(h.numbering.issue).not.toHaveBeenCalled();
    const h2 = signHarness();
    await h2.svc.sign(h2.ctx, actor(), 'L1', { confirm: true }, req);
    await expect(h2.svc.sign(h2.ctx, actor(), 'L1', { confirm: true }, req)).rejects.toThrow();
    expect(h2.numbering.issue).toHaveBeenCalledTimes(1);
  });

  it('a failed PDF render leaves no signature; the retry reuses the same number (no gap, no duplicate)', async () => {
    const h = signHarness({ renderFails: 1 });
    await expect(h.svc.sign(h.ctx, actor(), 'L1', { confirm: true }, req)).rejects.toThrow(/ساخت PDF امضا ناموفق/);
    expect(h.store.letter.status).toBe('PENDING_SIGNATURE');
    expect(h.store.attachments).toHaveLength(0);
    expect(h.evidence.tryRecord).not.toHaveBeenCalled();
    const out = await h.svc.sign(h.ctx, actor(), 'L1', { confirm: true }, req);
    expect(out.status).toBe('ISSUED');
    expect(out.letterNumber).toBe('ص/1405/00001');
    expect(h.numbering.issue).toHaveBeenCalledTimes(1);
  });

  it('only the owner/stamp delegate may use the company stamp', async () => {
    const h = signHarness();
    h.stamps.assertCanUse.mockRejectedValueOnce(new Error('no stamp'));
    await expect(h.svc.sign(h.ctx, actor(), 'L1', { confirm: true, useStamp: true }, req)).rejects.toThrow('no stamp');
    expect(h.numbering.issue).not.toHaveBeenCalled();
  });

  it('replying to an incoming letter marks it ANSWERED on issuance', async () => {
    const h = signHarness({ letter: { replyToLetterId: 'IN1' } });
    const incoming = { type: 'INCOMING', status: 'IN_PROGRESS', id: 'IN1' };
    (h.tenantDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (t: unknown) => unknown) => cb({
      corrLetter: {
        findUniqueOrThrow: async () => ({ ...h.store.letter }),
        findUnique: async () => incoming,
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (where.status && h.store.letter.status !== where.status) return { count: 0 };
          if ('letterNumber' in where && where.letterNumber === null && h.store.letter.letterNumber) return { count: 0 };
          Object.assign(h.store.letter, data);
          return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { if (where.id === 'IN1') Object.assign(incoming, data); else Object.assign(h.store.letter, data); return {}; },
      },
      attachment: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ATT1', ...data }) },
    }));
    await h.svc.sign(h.ctx, actor(), 'L1', { confirm: true }, req);
    expect(incoming.status).toBe('ANSWERED');
    expect(h.store.events).toContain('ANSWERED');
  });
});

describe('canonicalLetterContent / hash', () => {
  it('is stable and changes when the body changes', () => {
    const l = makeLetter({ letterNumber: 'N1' }) as never;
    const a = canonicalLetterContent(l, new Date('2026-10-20T00:00:00Z'), { userId: 'u', name: 'n' }, [], []);
    const b = canonicalLetterContent({ ...(l as object), bodyHtml: '<p>تغییر</p>' } as never, new Date('2026-10-20T00:00:00Z'), { userId: 'u', name: 'n' }, [], []);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

// ───────────────────────────── referrals / paraph ─────────────────────────────
function referralHarness(opts: { letter?: Record<string, unknown>; access?: string[] } = {}) {
  const letter = makeLetter({ type: 'INCOMING', status: 'REGISTERED', letterNumber: 'وارده/1405/00001', ...opts.letter }) as Record<string, unknown>;
  const referrals: Record<string, unknown>[] = [];
  const paraphs: Record<string, unknown>[] = [];
  const events: { type: string; meta?: unknown }[] = [];
  const users = [{ id: 'a', name: 'الف', status: 'ACTIVE' }, { id: 'b', name: 'ب', status: 'ACTIVE' }, { id: 'c', name: 'ج', status: 'ACTIVE' }];
  const tx = {
    corrReferral: {
      aggregate: async () => ({ _max: { seq: referrals.reduce((m, r) => Math.max(m, r.seq as number), 0) || null } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { const r = { id: `R${referrals.length + 1}`, status: 'PENDING', ...data }; referrals.push(r); return r; },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const cur = referrals.find((r) => r.id === where.id);
        const st = (where.status as { in?: string[] } | string | undefined);
        if (!cur || (st && typeof st === 'object' && st.in && !st.in.includes(cur.status as string)) || (typeof st === 'string' && cur.status !== st)) return { count: 0 };
        Object.assign(cur, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => referrals.find((r) => r.id === where.id),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(referrals.find((r) => r.id === where.id)!, data),
    },
    corrLetter: { update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(letter, data) },
    corrParaph: {
      aggregate: async () => ({ _max: { order: paraphs.length ? paraphs.length : null } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { const p = { id: `P${paraphs.length + 1}`, createdAt: new Date(), ...data }; paraphs.push(p); return p; },
    },
  };
  const tenantDb = {
    ...tx,
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    user: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => users.filter((u) => where.id.in.includes(u.id)) },
    corrReferral: { ...tx.corrReferral, findUnique: async ({ where }: { where: { id: string } }) => referrals.find((r) => r.id === where.id) ?? null, findFirst: async ({ where }: { where: { id?: string } }) => (where.id ? referrals.find((r) => r.id === where.id) ?? null : null), updateMany: tx.corrReferral.updateMany },
    corrParticipant: { findFirst: async () => ({ id: 'p' }) },
  };
  const core = {
    findVisible: async () => ({ ...letter }),
    usersWithModuleAccess: async () => new Set(opts.access ?? ['a', 'b', 'c', 'boss']),
    addParticipant: async () => undefined,
    logEvent: async (_d: unknown, _id: string, type: string, _a: unknown, _n: unknown, meta?: unknown) => { events.push({ type, meta }); },
    notify: vi.fn(async () => undefined),
  };
  const svc = new CorrespondenceReferralsService(core as never);
  const ctx = { tenantDb, tenantId: 't1', tenantSlug: 's', auth: { role: 'ADMIN' } } as never;
  return { svc, ctx, referrals, paraphs, events, letter, core };
}

describe('referrals', () => {
  const boss = actor({ userId: 'boss', isAdmin: true, isManager: true });

  it('fan-out creates one referral per recipient with an ordered chain and moves REGISTERED → REFERRED', async () => {
    const h = referralHarness();
    const out = await h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['a', 'b', 'a'], instruction: 'بررسی و اقدام', dueAt: '2026-11-01T00:00:00Z' });
    expect(out).toHaveLength(2);
    expect(h.referrals.map((r) => r.seq)).toEqual([1, 2]);
    expect(h.referrals.every((r) => r.status === 'PENDING' && r.fromUserId === 'boss' && r.instruction === 'بررسی و اقدام')).toBe(true);
    expect(h.letter.status).toBe('REFERRED');
    expect(h.core.notify).toHaveBeenCalledTimes(1);
    expect((h.core.notify.mock.calls[0] as unknown[])[1]).toEqual(['a', 'b']);
  });

  it('single ACTION referral transfers ownership; INFO copy does not', async () => {
    const h = referralHarness();
    await h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['a'] });
    expect(h.letter.ownerUserId).toBe('a');
    const h2 = referralHarness();
    await h2.svc.refer(h2.ctx, boss, 'L1', { toUserIds: ['a'], kind: 'INFO' });
    expect(h2.letter.ownerUserId).toBe('author');
  });

  it('rejects recipients without module access, self-only, unknown users and closed letters', async () => {
    const h = referralHarness({ access: ['b'] });
    await expect(h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['a'] })).rejects.toThrow(/دسترسی ندارد/);
    await expect(h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['boss'] })).rejects.toThrow(/گیرنده/);
    await expect(h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['zzz'] })).rejects.toThrow(/یافت نشد/);
    const closed = referralHarness({ letter: { status: 'CLOSED' } });
    await expect(closed.svc.refer(closed.ctx, boss, 'L1', { toUserIds: ['a'] })).rejects.toThrow(/ارجاع/);
  });

  it('only the addressee can mark seen / done; double completion conflicts; forward builds a chain', async () => {
    const h = referralHarness();
    await h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['a'] });
    const a = actor({ userId: 'a', isManager: false, matrix: { ...FULL, canEdit: false }, scope: { userId: 'a', isOwner: false, isAdmin: false, viewAll: false, viewOwn: true } });
    await expect(h.svc.markSeen(h.ctx, actor({ userId: 'b' }), 'R1')).rejects.toThrow(/به شما نیست/);
    await h.svc.markSeen(h.ctx, a, 'R1');
    expect(h.referrals[0].status).toBe('SEEN');
    const fwd = await h.svc.forward(h.ctx, a, 'R1', { toUserIds: ['b'], instruction: 'ادامه بدهید' });
    expect(fwd[0].parentReferralId).toBe('R1');
    expect(fwd[0].seq).toBe(2);
    expect(h.referrals[0].status).toBe('DONE');
    await expect(h.svc.complete(h.ctx, a, 'R1', 'x')).rejects.toThrow(/بسته/);
    expect(h.events.map((e) => e.type)).toEqual(expect.arrayContaining(['REFERRED', 'REFERRAL_SEEN', 'REFERRAL_FORWARDED']));
  });

  it('returning requires a response and notifies the sender', async () => {
    const h = referralHarness();
    await h.svc.refer(h.ctx, boss, 'L1', { toUserIds: ['a'] });
    const a = actor({ userId: 'a' });
    await h.svc.returnBack(h.ctx, a, 'R1', 'در حیطه‌ی من نیست');
    expect(h.referrals[0]).toMatchObject({ status: 'RETURNED', response: 'در حیطه‌ی من نیست' });
    expect((h.core.notify.mock.calls.at(-1) as unknown[])[1]).toEqual(['boss']);
  });
});

describe('paraph', () => {
  const p = actor({ userId: 'boss', isManager: true, isAdmin: true });
  it('appends ordered, immutable entries that carry author snapshot', async () => {
    const h = referralHarness({ letter: { type: 'OUTGOING', status: 'ISSUED' } });
    await h.svc.addParaph(h.ctx, p, 'L1', '  موافقم  ');
    await h.svc.addParaph(h.ctx, p, 'L1', 'اقدام شود');
    expect(h.paraphs.map((x) => [x.order, x.text, x.authorName])).toEqual([[1, 'موافقم', 'مدیر عامل'], [2, 'اقدام شود', 'مدیر عامل']]);
    expect(h.events.filter((e) => e.type === 'PARAPHED')).toHaveLength(2);
  });
  it('has no edit/delete API (immutability by construction)', () => {
    const names = Object.getOwnPropertyNames(CorrespondenceReferralsService.prototype).filter((n) => /paraph/i.test(n));
    expect(names).toEqual(['addParaph']);
  });
  it('refuses empty text and void/rejected letters', async () => {
    const h = referralHarness({ letter: { type: 'OUTGOING', status: 'ISSUED' } });
    await expect(h.svc.addParaph(h.ctx, p, 'L1', '  \u0000 ')).rejects.toThrow(/خالی/);
    const v = referralHarness({ letter: { status: 'VOID' } });
    await expect(v.svc.addParaph(v.ctx, p, 'L1', 'x')).rejects.toThrow(/پاراف/);
  });
});

// ───────────────────────────── incoming registration ─────────────────────────────
describe('incoming registration', () => {
  function makeSvc(existing: { id: string }[] = [], visibleIds: string[] = []) {
    const created: Record<string, unknown>[] = [];
    const tx = {
      corrLetter: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { ...data }; } },
    };
    const tenantDb = {
      corrLetterCategory: { findUnique: async () => ({ isActive: true }) },
      corrLetter: {
        findMany: vi.fn(async (args: { select: Record<string, boolean> }) => (args.select.letterNumber ? existing.filter((e) => visibleIds.includes(e.id)).map((e) => ({ ...e, letterNumber: 'وارده/1405/00009', subject: 'قبلی' })) : existing)),
        findUniqueOrThrow: async () => ({ ...(created[0] ?? {}) }),
      },
      $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    };
    const core = {
      assertCreate: () => undefined,
      visibleWhere: () => ({}),
      addParticipant: async () => undefined,
      logEvent: vi.fn(async () => undefined),
    };
    const numbering = { issue: vi.fn(async () => ({ number: 'وارده/1405/00001', schemeId: 's', periodKey: '1405', seq: 1 })) };
    const svc = new CorrespondenceLettersService(core as never, numbering as never, { refer: vi.fn() } as never, {} as never);
    return { svc, ctx: { tenantId: 't1', tenantDb } as never, created, numbering };
  }
  const dto = { subject: 'درخواست', externalNumber: '77/ب', externalDate: '2026-10-01T00:00:00Z', senderOrgName: 'شرکت ك' };

  it('issues the secretariat number atomically and stores the external number separately, with a verify token hash', async () => {
    const { svc, ctx, created, numbering } = makeSvc();
    await svc.registerIncoming(ctx, actor(), dto);
    expect(numbering.issue).toHaveBeenCalledTimes(1);
    expect(created[0]).toMatchObject({ type: 'INCOMING', status: 'REGISTERED', letterNumber: 'وارده/1405/00001', externalNumber: '77/ب' });
    expect(created[0].verifyTokenHash).toBe(hashVerifyToken(deriveVerifyToken('t1', created[0].id as string)));
    expect(created[0].senderKey).toBe('t:شرکت ک');
  });

  it('blocks duplicates (same sender + external number + date) unless an authorised user overrides; never leaks hidden ones', async () => {
    const dup = makeSvc([{ id: 'X1' }, { id: 'X2' }], ['X1']);
    await expect(dup.svc.registerIncoming(dup.ctx, actor(), dto)).rejects.toMatchObject({ response: { code: 'DUPLICATE_INCOMING', duplicates: [expect.objectContaining({ id: 'X1' })] } });
    expect(dup.numbering.issue).not.toHaveBeenCalled(); // شماره‌ای مصرف نمی‌شود
    const res = await dup.svc.registerIncoming(dup.ctx, actor(), { ...dto, allowDuplicate: true }).catch((e) => e);
    expect(res).not.toBeInstanceOf(Error);
    const noPerm = makeSvc([{ id: 'X1' }], ['X1']);
    await expect(noPerm.svc.registerIncoming(noPerm.ctx, actor({ matrix: { ...FULL, canEdit: false } }), { ...dto, allowDuplicate: true })).rejects.toThrow(/مجاز/);
  });

  it('sender key normalises Arabic/Persian letters and whitespace; contact id wins', () => {
    expect(normalizeSenderKey(null, 'شركت  كيان', null)).toBe(normalizeSenderKey(null, 'شرکت کیان', null));
    expect(normalizeSenderKey('c1', 'x', 'y')).toBe('c:c1');
    expect(normalizeSenderKey(null, null, null)).toBeNull();
  });
});

// ───────────────────────────── public verification ─────────────────────────────
describe('public verification', () => {
  const token = deriveVerifyToken('t1', 'L1');
  function makeSvc(letter: Record<string, unknown> | null, moduleInstalled = true, tenantOk = true) {
    const controlDb = {
      tenant: { findUnique: async () => (tenantOk ? { id: 't1', name: 'شرکت نمونه', slug: 'acme', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd' } : null) },
      tenantModule: { findFirst: async () => (moduleInstalled ? { id: 'm' } : null) },
    };
    const findUnique = vi.fn(async () => letter);
    const tenantPrisma = { forTenant: () => ({ corrLetter: { findUnique } }) };
    return { svc: new CorrespondencePublicService(controlDb as never, tenantPrisma as never), findUnique };
  }
  const issued = { letterNumber: 'ص/1405/00001', status: 'ISSUED', type: 'OUTGOING', signedAt: new Date(), registeredAt: null, letterDate: new Date('2026-10-20T00:00:00Z'), issuedAt: new Date(), signerName: 'مدیر عامل', subject: 'SECRET SUBJECT', bodyHtml: 'SECRET BODY' };

  it('returns exactly the allowed fields and never content', async () => {
    const { svc, findUnique } = makeSvc(issued);
    const r = await svc.verify('acme', token);
    expect(Object.keys(r).sort()).toEqual(['date', 'issuerOrg', 'letterNumber', 'signerName', 'status', 'valid']);
    expect(r).toMatchObject({ valid: true, letterNumber: 'ص/1405/00001', date: '2026-10-20', signerName: 'مدیر عامل', issuerOrg: 'شرکت نمونه', status: 'ACTIVE' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    // پرس‌وجو فقط ستون‌های لازم را انتخاب می‌کند
    const sel = (findUnique.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0].select;
    expect(sel.subject).toBeUndefined();
    expect(sel.bodyHtml).toBeUndefined();
  });
  it('voided letters are reported invalid but identifiable', async () => {
    const r = await makeSvc({ ...issued, status: 'VOID' }).svc.verify('acme', token);
    expect(r).toMatchObject({ valid: false, status: 'VOID', letterNumber: 'ص/1405/00001' });
  });
  it('unknown token / tenant / module / malformed input all look identical (no enumeration)', async () => {
    const blank = { valid: false, letterNumber: null, date: null, signerName: null, issuerOrg: null, status: null };
    expect(await makeSvc(null).svc.verify('acme', token)).toEqual(blank);
    expect(await makeSvc(issued, false).svc.verify('acme', token)).toEqual(blank);
    expect(await makeSvc(issued, true, false).svc.verify('nope', token)).toEqual(blank);
    expect(await makeSvc(issued).svc.verify('acme', 'short')).toEqual(blank);
    expect(await makeSvc(issued).svc.verify('ac me;', token)).toEqual(blank);
    // نامه‌ی با شماره‌ی رزروشده ولی هنوز امضا‌نشده معتبر نیست
    expect(await makeSvc({ ...issued, signedAt: null }).svc.verify('acme', token)).toEqual(blank);
  });
  it('incoming slip tokens verify the registration only (no signer)', async () => {
    const r = await makeSvc({ ...issued, type: 'INCOMING', signedAt: null, registeredAt: new Date('2026-10-02T06:00:00Z') }).svc.verify('acme', token);
    expect(r).toMatchObject({ valid: true, signerName: null, date: '2026-10-02' });
  });
  it('tokens are high-entropy, deterministic per letter and distinct across letters', () => {
    const a = deriveVerifyToken('t1', 'L1');
    expect(isWellFormedToken(a)).toBe(true);
    expect(a).toBe(deriveVerifyToken('t1', 'L1'));
    expect(a).not.toBe(deriveVerifyToken('t1', 'L2'));
    expect(a).not.toBe(deriveVerifyToken('t2', 'L1'));
    expect(hashVerifyToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rate limiter blocks bursts per key and recovers after the window', () => {
    const l = new FixedWindowLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => l.allow('ip', 0))).toEqual([true, true, true, false]);
    expect(l.allow('other', 0)).toBe(true);
    expect(l.allow('ip', 1500)).toBe(true);
  });
});
