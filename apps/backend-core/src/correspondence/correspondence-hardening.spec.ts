import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { transferOwnership } from '../users/offboarding/offboarding.engine.js';
import { TRANSFERABLE } from '../users/offboarding/ownership-registry.js';
import { CorrespondenceLettersService } from './correspondence-letters.service.js';
import { CorrespondenceSettingsService } from './correspondence-settings.service.js';
import { CorrespondenceNumberingService } from './correspondence-numbering.service.js';
import { CorrespondenceWorkflowService } from './correspondence-workflow.service.js';
import { CorrespondencePublicService, CorrespondencePublicController } from './correspondence-public.js';
import { CorrespondenceController } from './correspondence.controller.js';
import { escapeLike, buildLetterFilterWhere } from './letter-search.js';
import { validatePattern } from './numbering.js';
import { cleanText } from './text-clean.js';
import { deriveVerifyToken } from './verify-token.js';
import type { CorrActor } from './correspondence-core.service.js';

const FULL = { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: true };
const actor = (over: Partial<CorrActor> = {}): CorrActor => ({
  userId: 'u1', name: 'کاربر', title: null, isOwner: false, isAdmin: false, isManager: false, matrix: FULL,
  scope: { userId: 'u1', isOwner: false, isAdmin: false, viewAll: true, viewOwn: true }, ...over,
});

// ───────── H1: خروج کاربر ─────────
describe('offboarding registry for correspondence', () => {
  const entry = (k: string) => TRANSFERABLE.find((e) => e.key === k)!;
  it('letter owner transfer excludes SECRET letters and drafts', () => {
    const w = JSON.stringify(entry('CorrLetter.ownerUserId').scope!(new Date()));
    expect(w).toContain('"confidentiality":{"not":"SECRET"}');
    expect(w).toContain('DRAFT');
    expect(w).toContain('VOID');
  });
  it('signer and referral transfers never move SECRET letters', () => {
    expect(JSON.stringify(entry('CorrLetter.signerUserId').scope!(new Date()))).toContain('"not":"SECRET"');
    expect(JSON.stringify(entry('CorrReferral.toUserId').scope!(new Date()))).toContain('"letter":{"confidentiality":{"not":"SECRET"}}');
  });
  it('moving referrals gives the target a REFERRAL participant row (L4)', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const refEntry = entry('CorrReferral.toUserId');
    const db = new Proxy({}, {
      get: (_t, name: string) => {
        if (name === 'corrReferral') return {
          findMany: async (a: { select: Record<string, boolean>; where: Record<string, unknown> }) => (a.select.letterId ? [{ letterId: 'L1' }, { letterId: 'L1' }, { letterId: 'L2' }] : [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }]),
          updateMany: async () => ({ count: 3 }),
        };
        if (name === 'corrParticipant') return { createMany };
        return { findMany: async () => [], count: async () => 0, updateMany: async () => ({ count: 0 }) };
      },
    });
    const only = TRANSFERABLE;
    TRANSFERABLE.splice(0, TRANSFERABLE.length, refEntry);
    try {
      await transferOwnership(db as never, { fromUserId: 'old', targetFor: () => 'new', now: new Date(), dryRun: false });
    } finally {
      TRANSFERABLE.splice(0, TRANSFERABLE.length, ...only);
    }
    expect(createMany).toHaveBeenCalledWith({ data: [{ letterId: 'L1', userId: 'new', role: 'REFERRAL' }, { letterId: 'L2', userId: 'new', role: 'REFERRAL' }], skipDuplicates: true });
  });
});

// ───────── M1/M2: ویرایش و ابطال ─────────
function lettersHarness(letter: Record<string, unknown>) {
  const events: { type: string; meta?: unknown }[] = [];
  const revisions: unknown[] = [];
  const tx = {
    corrLetter: { updateMany: vi.fn(async () => ({ count: 1 })), findUniqueOrThrow: async () => ({ ...letter }), update: async () => ({}) },
    corrRevision: { create: async (a: unknown) => { revisions.push(a); } },
    corrReferral: { updateMany: async () => ({ count: 0 }) },
  };
  const tenantDb = { $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx), corrParticipant: { findMany: async () => [] }, corrLetterCategory: { findUnique: async () => ({ isActive: true }) } };
  const core = {
    findVisible: async () => ({ ...letter }),
    canMutateContent: () => true,
    logEvent: async (_d: unknown, _id: string, type: string, _a: unknown, _n: unknown, meta?: unknown) => { events.push({ type, meta }); },
    notify: vi.fn(async () => undefined),
    controlDbRef: { tenantMembership: { findMany: async () => [] } },
  };
  const svc = new CorrespondenceLettersService(core as never, {} as never, {} as never, {} as never);
  return { svc, ctx: { tenantId: 't', tenantDb } as never, events, revisions, tx, core };
}
const base = (over: Record<string, unknown> = {}) => ({
  id: 'L1', type: 'OUTGOING', status: 'DRAFT', archivedAt: null, subject: 'a', bodyHtml: '<p>a</p>', confidentiality: 'NORMAL', createdByUserId: 'u1', ownerUserId: 'u1',
  signerUserId: null, signedByUserId: null, revisionNo: 1, updatedAt: new Date('2026-10-01T00:00:00Z'), recipients: [], ccNames: [], tags: [], ...over,
});

describe('M1 autosave & confidentiality', () => {
  it('autosave on a draft makes no revision/event', async () => {
    const h = lettersHarness(base());
    await h.svc.update(h.ctx, actor(), 'L1', { subject: 'b', autosave: true });
    expect(h.revisions).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });
  it('autosave is ignored for incoming letters: reason, revision and event are mandatory', async () => {
    const h = lettersHarness(base({ type: 'INCOMING', status: 'REGISTERED' }));
    await expect(h.svc.update(h.ctx, actor(), 'L1', { subject: 'b', autosave: true })).rejects.toBeInstanceOf(BadRequestException);
    await h.svc.update(h.ctx, actor(), 'L1', { subject: 'b', autosave: true, reason: 'اصلاح موضوع' });
    expect(h.revisions).toHaveLength(1);
    expect(h.events.map((e) => e.type)).toEqual(['EDITED']);
  });
  it('a confidentiality change is always audited — even through autosave', async () => {
    const h = lettersHarness(base());
    await h.svc.update(h.ctx, actor(), 'L1', { confidentiality: 'SECRET', autosave: true });
    expect(h.revisions).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ type: 'EDITED', meta: { confidentiality: { from: 'NORMAL', to: 'SECRET' } } });
  });
  it('only creator/owner or a manager may change it; lowering is manager-only', async () => {
    const stranger = lettersHarness(base({ createdByUserId: 'x', ownerUserId: 'x' }));
    await expect(stranger.svc.update(stranger.ctx, actor(), 'L1', { confidentiality: 'CONFIDENTIAL' })).rejects.toThrow(/فقط سازنده/);
    const lower = lettersHarness(base({ confidentiality: 'SECRET' }));
    await expect(lower.svc.update(lower.ctx, actor(), 'L1', { confidentiality: 'NORMAL' })).rejects.toThrow(/کاهش/);
    const raise = lettersHarness(base());
    await raise.svc.update(raise.ctx, actor(), 'L1', { confidentiality: 'VERY_CONFIDENTIAL' });
    const mgr = lettersHarness(base({ confidentiality: 'SECRET', createdByUserId: 'x', ownerUserId: 'x' }));
    await mgr.svc.update(mgr.ctx, actor({ isManager: true, isAdmin: true }), 'L1', { confidentiality: 'NORMAL' });
  });
});

describe('M2 voiding after DRAFT', () => {
  const issued = (over = {}) => base({ status: 'ISSUED', letterNumber: 'N1', signerUserId: 'signer', signedByUserId: 'signer', ...over });
  it('a plain user (even with delete rights) can only request voiding an issued letter', async () => {
    const h = lettersHarness(issued());
    const r = await h.svc.voidLetter(h.ctx, actor(), 'L1', 'اشتباه');
    expect(r).toEqual({ requested: true });
    expect(h.events.map((e) => e.type)).toEqual(['VOID_REQUESTED']);
    expect(h.tx.corrLetter.updateMany).not.toHaveBeenCalled();
  });
  it('signer and managers can void; own drafts too', async () => {
    const s = lettersHarness(issued());
    expect(await s.svc.voidLetter(s.ctx, actor({ userId: 'signer' }), 'L1', 'اشتباه')).not.toHaveProperty('requested');
    const m = lettersHarness(issued());
    expect(await m.svc.voidLetter(m.ctx, actor({ isManager: true }), 'L1', 'اشتباه')).not.toHaveProperty('requested');
    const d = lettersHarness(base());
    expect(await d.svc.voidLetter(d.ctx, actor(), 'L1', 'اشتباه')).not.toHaveProperty('requested');
  });
  it('someone with no rights at all cannot even request', async () => {
    const h = lettersHarness(issued({ createdByUserId: 'x' }));
    await expect(h.svc.voidLetter(h.ctx, actor({ matrix: { ...FULL, canEdit: false, canDelete: false } }), 'L1', 'x y')).rejects.toThrow(/اجازه/);
  });
});

// ───────── M3: رقابت در امضا ─────────
describe('M3 sign race', () => {
  function harness(mutate: (l: Record<string, unknown>) => void) {
    const letter: Record<string, unknown> = { ...base({ status: 'PENDING_SIGNATURE', signerUserId: 'signer', letterNumber: null, issuedAt: null }) };
    const tx = {
      corrLetter: {
        findUniqueOrThrow: async () => ({ ...letter }),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          for (const k of ['revisionNo', 'subject', 'bodyHtml', 'signerUserId'] as const) if (k in where && where[k] !== letter[k]) return { count: 0 };
          if (where.status && letter.status !== where.status) return { count: 0 };
          Object.assign(letter, data);
          return { count: 1 };
        }),
        update: async () => ({}), findUnique: async () => null,
      },
      attachment: { create: async () => ({ id: 'A' }) },
    };
    const tenantDb = { $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx), corrParaph: { findMany: async () => [] }, attachment: { findMany: async () => [] } };
    const core = { findVisible: async () => ({ ...letter }), userBrief: async () => ({ name: 'n', title: null }), addParticipant: async () => undefined, logEvent: async () => undefined, notify: async () => undefined };
    const numbering = { issue: vi.fn(async () => ({ number: 'N1', schemeId: 's', periodKey: 'p', seq: 1 })) };
    const render = { build: async () => ({ signature: null }), render: vi.fn(async () => { mutate(letter); return Buffer.from('%PDF'); }) };
    const svc = new CorrespondenceWorkflowService(core as never, numbering as never, render as never, { tryRecord: async () => ({}) } as never, {} as never, { resolve: async () => ({ fields: { signerTitle: '', orgName: '', signerName: 'n', honorific: '', showDate: true }, titleLine: 'T', nameLine: 'N', showDate: true }) } as never);
    return { svc, ctx: { tenantId: 't', tenantSlug: 's', tenantDb, auth: { role: 'MEMBER', sub: 'g' } } as never, letter, render };
  }
  const req = { headers: {} } as never;
  it('letter edited/returned while the PDF renders → clear conflict, no stale snapshot', async () => {
    const h = harness((l) => { l.revisionNo = 2; l.bodyHtml = '<p>changed</p>'; });
    await expect(h.svc.sign(h.ctx, actor({ userId: 'signer' }), 'L1', { confirm: true }, req)).rejects.toThrow(/در حین امضا تغییر کرد/);
    expect(h.letter.status).toBe('PENDING_SIGNATURE');
  });
  it('signer replaced during rendering → conflict for a non-owner', async () => {
    const h = harness((l) => { l.signerUserId = 'someone-else'; });
    await expect(h.svc.sign(h.ctx, actor({ userId: 'signer' }), 'L1', { confirm: true }, req)).rejects.toThrow(/در حین امضا تغییر کرد/);
  });
  it('untouched letter signs normally', async () => {
    const h = harness(() => undefined);
    const out = await h.svc.sign(h.ctx, actor({ userId: 'signer' }), 'L1', { confirm: true }, req);
    expect(out.status).toBe('ISSUED');
  });
});

// ───────── M6 ─────────
describe('M6 numbering pattern rules', () => {
  it('yearly/monthly reset need period tokens', () => {
    expect(validatePattern('ص/{SEQ:5}', 'YEARLY')).toMatch(/سالانه/);
    expect(validatePattern('ص/{YYYY}/{SEQ:5}', 'YEARLY')).toBeNull();
    expect(validatePattern('ص/{YY}-{SEQ:5}', 'YEARLY')).toBeNull();
    expect(validatePattern('ص/{YYYY}/{SEQ:5}', 'MONTHLY')).toMatch(/ماه/);
    expect(validatePattern('{YYYY}{MM}-{SEQ:3}', 'MONTHLY')).toBeNull();
    expect(validatePattern('ص/{SEQ:5}', 'NEVER')).toBeNull();
  });
  it('duplicate active (type, pattern) is rejected with a Persian message; also on update', async () => {
    const findFirst = vi.fn(async () => ({ id: 'other' }));
    const tx = { corrNumberingScheme: { count: async () => 1, updateMany: async () => ({}), create: async (a: unknown) => a } };
    const ctx = { tenantDb: { corrNumberingScheme: { findFirst, findUnique: async () => ({ id: 's', type: 'OUTGOING', pattern: 'a/{YYYY}/{SEQ:3}', resetPolicy: 'YEARLY', isActive: true }) }, $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } } as never;
    const svc = new CorrespondenceSettingsService(new CorrespondenceNumberingService());
    await expect(svc.createScheme(ctx, { name: 'x', type: 'OUTGOING', pattern: 'ص/{YYYY}/{SEQ:5}' } as never)).rejects.toThrow(/همین الگو/);
    await expect(svc.updateScheme(ctx, 's', { pattern: 'ص/{YYYY}/{SEQ:6}' } as never)).rejects.toThrow(/همین الگو/);
    findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.createScheme(ctx, { name: 'x', type: 'OUTGOING', pattern: 'ص/{YYYY}/{SEQ:5}' } as never)).resolves.toBeTruthy();
  });
});

describe('L8 folder cycle', () => {
  it('rejects moving a folder under its own descendant (multi-level)', async () => {
    const rows = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }];
    const ctx = { tenantDb: { corrArchiveFolder: { findMany: async () => rows, update: async () => ({}) } } } as never;
    const svc = new CorrespondenceSettingsService({} as never);
    await expect(svc.updateFolder(ctx, 'a', { parentId: 'c' })).rejects.toThrow(/زیرمجموعه/);
    await expect(svc.updateFolder(ctx, 'a', { parentId: 'a' })).rejects.toThrow();
    await expect(svc.updateFolder(ctx, 'c', { parentId: 'zzz' })).rejects.toThrow(/یافت نشد/);
    await expect(svc.updateFolder(ctx, 'c', { parentId: 'a' })).resolves.toBeDefined();
  });
});

// ───────── search/escape/text ─────────
describe('input hygiene', () => {
  it('LIKE wildcards are neutralised in contains filters', () => {
    expect(escapeLike('100%_off\\x')).toBe('100  off x');
    const w = JSON.stringify(buildLetterFilterWhere({ q: '%_%_%_', archived: 'all' }, null));
    expect(w).toBe('{}'); // فقط wildcard → فیلتر ساخته نمی‌شود
    expect(JSON.stringify(buildLetterFilterWhere({ number: '77_ب', archived: 'all' }, null))).toContain('"contains":"77 ب"');
  });
  it('bidi isolates/overrides and control chars are stripped, RLM/ZWNJ kept', () => {
    expect(cleanText('ab‮cd⁦ef⁩\u0007gh')).toBe('abcdefgh');
    expect(cleanText('می‌خواهم‏')).toBe('می‌خواهم‏');
    expect(cleanText('line1\nline2\t')).toBe('line1\nline2\t');
  });
  it('non-string query params → 400, not 500', async () => {
    const c = new CorrespondenceController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    for (const bad of [{ q: ['a', 'b'] }, { status: { a: '1' } }, { createdByUserId: ['x'] }, { relatedContactId: { $ne: 1 } }, { replyToLetterId: ['y'] }]) {
      await expect(c.list(bad as never, {} as never)).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.registerCsv(bad as never, {} as never, {} as never)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(c.inbox(['x'] as never, {} as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ───────── L1/L2/L5/L3 ─────────
describe('public verify hardening (L1)', () => {
  it('every response — hit, miss or malformed — takes at least the minimum time', async () => {
    const controlDb = { tenant: { findUnique: async () => null }, tenantModule: { findFirst: async () => null } };
    const svc = new CorrespondencePublicService(controlDb as never, {} as never);
    const t0 = Date.now();
    await svc.verify('nope', deriveVerifyToken('t', 'l'));
    await svc.verify('bad slug', 'x');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * CorrespondencePublicService.MIN_RESPONSE_MS - 10);
  });
  it('sets no-store and rate-limits an IPv6 /64 as a single client', async () => {
    const meta = Reflect.getMetadata('__headers__', CorrespondencePublicController.prototype.verify) as Array<{ name: string; value: string }>;
    expect(meta).toEqual(expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]));
    const svc = { allow: vi.fn(() => true), verify: vi.fn(async () => ({})) };
    const ctl = new CorrespondencePublicController(svc as never);
    await ctl.verify('s', 't', { headers: {}, socket: { remoteAddress: '2001:db8:1:2:aaaa::1' } } as never);
    await ctl.verify('s', 't', { headers: {}, socket: { remoteAddress: '2001:db8:1:2:bbbb::9' } } as never);
    const keys = svc.allow.mock.calls.map((c) => (c as unknown[])[0]);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('L5 people / number preview for view-own users', () => {
  it('view-own users get only accessible people and no global counter preview', async () => {
    const tenantDb = {
      user: { findMany: async () => [{ id: 'a', name: 'الف' }, { id: 'b', name: 'ب' }] },
      employee: { findMany: async () => [] },
    };
    const core = { usersWithModuleAccess: async () => new Set(['a']) };
    const svc = new CorrespondenceLettersService(core as never, {} as never, {} as never, {} as never);
    const ctx = { tenantDb } as never;
    expect((await svc.people(ctx, true)).map((p) => p.id)).toEqual(['a']);
    expect((await svc.people(ctx, false)).map((p) => p.id)).toEqual(['a', 'b']);
    const settings = { previewNext: vi.fn(async () => ({ next: 'X' })) };
    const c = new CorrespondenceController({ actor: async () => actor({ matrix: { ...FULL, canViewAll: false } }) } as never, {} as never, {} as never, {} as never, settings as never, {} as never);
    expect(await c.previewNumber('OUTGOING', undefined, {} as never)).toEqual({ next: null, schemeId: null, pattern: null });
    expect(settings.previewNext).not.toHaveBeenCalled();
  });
  it('check-duplicate returns only a boolean plus the caller-visible matches (no hidden count)', async () => {
    const letters = { findDuplicates: async () => ({ count: 3, visible: [{ id: 'x', letterNumber: 'N', subject: 's' }] }) };
    const c = new CorrespondenceController({ actor: async () => actor() } as never, letters as never, {} as never, {} as never, {} as never, {} as never);
    const r = await c.checkDuplicate({} as never, {} as never);
    expect(r).toEqual({ hasDuplicate: true, duplicates: [{ id: 'x', letterNumber: 'N', subject: 's' }] });
    expect(JSON.stringify(r)).not.toContain('hidden');
  });
});

describe('verify token fail-closed (L8)', () => {
  it('in production without APP_SECRETS_KEY the token derivation fails instead of using a dev key', () => {
    const old = { env: process.env.NODE_ENV, key: process.env.APP_SECRETS_KEY };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_SECRETS_KEY;
      expect(() => deriveVerifyToken('t', 'l')).toThrow(/کلید اسرار/);
      process.env.NODE_ENV = 'test';
      expect(deriveVerifyToken('t', 'l')).toHaveLength(43);
    } finally {
      process.env.NODE_ENV = old.env;
      if (old.key !== undefined) process.env.APP_SECRETS_KEY = old.key;
    }
  });
});

// ───────── L3 / L6 ─────────
import { CorrespondenceCronService } from './correspondence-cron.service.js';

describe('cron selection (L3) and evidence alert (L6)', () => {
  function cronHarness() {
    const calls: Record<string, unknown[]> = { referral: [], letter: [] };
    const events: Record<string, unknown>[] = [{ id: 'E1', letterId: 'L1', type: 'EVIDENCE_PENDING', note: null }];
    const db = {
      corrReferral: { findMany: vi.fn(async (a: unknown) => { calls.referral.push(a); return []; }), updateMany: async () => ({ count: 1 }) },
      corrLetter: { findMany: vi.fn(async (a: unknown) => { calls.letter.push(a); return []; }), findUnique: async () => ({ id: 'L1', subject: 'س', letterNumber: 'N', confidentiality: 'SECRET' }) },
      corrEvent: {
        findMany: async () => events.filter((e) => e.note === null),
        updateMany: async ({ where, data }: { where: { id: string; note: null }; data: { note: string } }) => {
          const e = events.find((x) => x.id === where.id && x.note === null);
          if (!e) return { count: 0 };
          e.note = data.note;
          return { count: 1 };
        },
      },
      user: { findMany: async () => [{ id: 'm1', name: 'مدیر', globalUserId: 'g', email: null, phone: '' }] },
    };
    const controlDb = { tenantMembership: { findMany: async () => [{ globalUserId: 'g', globalUser: { phone: '0912' } }] } };
    const core = { notify: vi.fn(async () => undefined), logEvent: vi.fn(async () => undefined) };
    const svc = new CorrespondenceCronService(controlDb as never, {} as never, core as never);
    return { svc, db, calls, core };
  }
  const now = new Date('2026-10-20T10:00:00Z');
  it('only not-yet-notified rows are fetched, in a stable order', async () => {
    const h = cronHarness();
    await h.svc.runForTenant({ tenantId: 't', tenantDb: h.db } as never, now);
    const ref = h.calls.referral[0] as { where: { OR: unknown[] }; orderBy: unknown[] };
    expect(ref.where.OR).toEqual([{ dueNotifiedAt: null }, { overdueNotifiedAt: null }]);
    expect(ref.orderBy).toEqual([{ dueAt: 'asc' }, { id: 'asc' }]);
    expect(JSON.stringify(h.calls.letter)).toContain('"none":{"type":"REMINDER","note":"RESPONSE_OVERDUE"}');
    expect(JSON.stringify(h.calls.letter)).toContain('"none":{"type":"REMINDER","note":"RESPONSE_DUE"}');
  });
  it('a signed letter without stored evidence alerts the managers exactly once, with generic text', async () => {
    const h = cronHarness();
    await h.svc.runForTenant({ tenantId: 't', tenantDb: h.db } as never, now);
    await h.svc.runForTenant({ tenantId: 't', tenantDb: h.db } as never, now);
    const evCalls = h.core.notify.mock.calls.filter((c) => (c as unknown[])[3] === 'correspondence.evidence_pending');
    expect(evCalls).toHaveLength(1);
    expect((evCalls[0] as unknown[])[1]).toEqual(['m1']);
  });
});

describe('sign without evidence (L6)', () => {
  it('records EVIDENCE_PENDING when tryRecord fails; the signature itself still succeeds', async () => {
    const events: string[] = [];
    const letter: Record<string, unknown> = { ...base({ status: 'PENDING_SIGNATURE', signerUserId: 'signer', letterNumber: null }) };
    const tx = {
      corrLetter: {
        findUniqueOrThrow: async () => ({ ...letter }), findUnique: async () => null, update: async () => ({}),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(letter, data); return { count: 1 }; },
      },
      attachment: { create: async () => ({ id: 'A' }) },
    };
    const tenantDb = { $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx), corrParaph: { findMany: async () => [] }, attachment: { findMany: async () => [] } };
    const core = { findVisible: async () => ({ ...letter }), userBrief: async () => ({ name: 'n', title: null }), addParticipant: async () => undefined, logEvent: async (_d: unknown, _i: string, t: string) => { events.push(t); }, notify: async () => undefined };
    const svc = new CorrespondenceWorkflowService(core as never, { issue: async () => ({ number: 'N', schemeId: 's', periodKey: 'p', seq: 1 }) } as never, { build: async () => ({ signature: null }), render: async () => Buffer.from('%PDF') } as never, { tryRecord: async () => null } as never, {} as never, { resolve: async () => ({ fields: { signerTitle: '', orgName: '', signerName: 'n', honorific: '', showDate: true }, titleLine: 'T', nameLine: 'N', showDate: true }) } as never);
    const out = await svc.sign({ tenantId: 't', tenantSlug: 's', tenantDb, auth: { role: 'MEMBER', sub: 'g' } } as never, actor({ userId: 'signer' }), 'L1', { confirm: true }, { headers: {} } as never);
    expect(out.status).toBe('ISSUED');
    expect(events).toContain('EVIDENCE_PENDING');
  });
});
