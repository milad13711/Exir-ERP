import { describe, expect, it, vi } from 'vitest';
import { PeriodsController } from './periods.controller.js';
import { JournalEntriesController } from './journal-entries.controller.js';

const okPerms = () => ({ assertView: vi.fn(), assertEdit: vi.fn(), assertCreate: vi.fn(), assertDelete: vi.fn(), viewScope: vi.fn(async () => ({})) }) as any;

function ctxFor(role: 'OWNER' | 'ADMIN' | 'MEMBER', over: Record<string, any> = {}) {
  const locks = new Map<string, any>();
  const tenantDb: any = {
    user: { findUnique: vi.fn(async () => ({ id: 'u1' })) },
    journalEntry: { count: vi.fn(async () => 2), aggregate: vi.fn(async () => ({ _min: { date: null } })), findFirst: vi.fn(async () => over.entry ?? null), findUnique: vi.fn(async () => over.entry ?? null), create: vi.fn(async () => ({ id: 'je', number: 1, lines: [] })), update: vi.fn(), delete: vi.fn() },
    moduleSetting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async ({ create }: any) => ({ ...create })) },
    accountingPeriodLock: {
      findMany: vi.fn(async () => [...locks.values()]),
      findUnique: vi.fn(async ({ where }: any) => locks.get(where.periodKey) ?? null),
      upsert: vi.fn(async ({ where, create }: any) => {
        const row = { id: 'l1', ...create };
        locks.set(where.periodKey, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = { ...locks.get(where.periodKey), ...data };
        locks.set(where.periodKey, row);
        return row;
      }),
    },
    activityLog: { create: vi.fn(async () => ({})) },
    journalLine: { count: vi.fn() },
    ...over.db,
  };
  return { ctx: { tenantDb, auth: { type: 'user', sub: 'g1', role } } as any, tenantDb, locks };
}

describe('PeriodsController — lock / unlock', () => {
  it('manager can lock a month; audit row is written; drafts are reported', async () => {
    const c = new PeriodsController(okPerms());
    const { ctx, tenantDb, locks } = ctxFor('ADMIN');
    const r = await c.lock('1405-07', { note: 'پایان مهر' }, ctx);
    expect(r).toMatchObject({ key: '1405-07', locked: true, draftsInPeriod: 2 });
    expect(locks.get('1405-07').isLocked).toBe(true);
    expect(tenantDb.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'accounting.period.locked' }) }));
  });

  it('non-manager roles cannot lock or unlock (403)', async () => {
    const c = new PeriodsController(okPerms());
    const { ctx } = ctxFor('MEMBER');
    await expect(c.lock('1405-07', {}, ctx)).rejects.toMatchObject({ status: 403 });
    await expect(c.unlock('1405-07', { reason: 'اصلاح سند' }, ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('lock requires the accounting edit permission', async () => {
    const perms = okPerms();
    perms.assertEdit.mockRejectedValue(new Error('forbidden'));
    const { ctx } = ctxFor('OWNER');
    await expect(new PeriodsController(perms).lock('1405-07', {}, ctx)).rejects.toThrow('forbidden');
  });

  it('unlock needs a reason, a locked month, and is audited', async () => {
    const c = new PeriodsController(okPerms());
    const { ctx, tenantDb, locks } = ctxFor('OWNER');
    await expect(c.unlock('1405-07', { reason: 'x' }, ctx)).rejects.toThrow(/دلیل/);
    await expect(c.unlock('1405-07', { reason: 'اصلاح سند' }, ctx)).rejects.toThrow(/قفل نیست/);
    await c.lock('1405-07', {}, ctx);
    await c.unlock('1405-07', { reason: 'اصلاح سند' }, ctx);
    expect(locks.get('1405-07').isLocked).toBe(false);
    expect(tenantDb.activityLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'accounting.period.unlocked' }) }));
  });

  it('rejects malformed period keys', async () => {
    const c = new PeriodsController(okPerms());
    await expect(c.lock('1405-99', {}, ctxFor('OWNER').ctx)).rejects.toThrow();
  });

  it('list returns 12 months with lock flags for the fiscal year', async () => {
    const c = new PeriodsController(okPerms());
    const { ctx } = ctxFor('OWNER');
    await c.lock('1405-07', {}, ctx);
    const r = await c.list('1405', ctx);
    expect(r.months).toHaveLength(12);
    expect(r.months.find((m) => m.key === '1405-07')!.locked).toBe(true);
    expect(r.months.find((m) => m.key === '1405-08')!.locked).toBe(false);
  });
});

describe('JournalEntriesController — lock enforcement', () => {
  const approvals = { registerHandler: vi.fn(), runOrRequest: vi.fn(), closeForEntity: vi.fn() } as any;
  const dto = { date: '2026-10-25', description: 'x', lines: [{ accountId: '00000000-0000-4000-8000-000000000001', debit: 100 }, { accountId: '00000000-0000-4000-8000-000000000002', credit: 100 }] } as any;

  it('refuses to create an entry dated inside a locked month (1405-08 = 2026-10-23..)', async () => {
    const c = new JournalEntriesController(okPerms(), approvals);
    const { ctx, tenantDb, locks } = ctxFor('OWNER');
    locks.set('1405-08', { isLocked: true });
    await expect(c.create(dto, ctx)).rejects.toThrow(/آبان/);
    expect(tenantDb.journalEntry.create).not.toHaveBeenCalled();
  });

  it('allows the same entry once the month is unlocked / for an open month', async () => {
    const c = new JournalEntriesController(okPerms(), approvals);
    const { ctx, tenantDb } = ctxFor('OWNER');
    await c.create(dto, ctx);
    expect(tenantDb.journalEntry.create).toHaveBeenCalled();
  });

  it('refuses to post a draft dated in a locked month', async () => {
    const c = new JournalEntriesController(okPerms(), approvals);
    const { ctx, tenantDb, locks } = ctxFor('OWNER', { entry: { id: 'e1', number: 3, status: 'DRAFT', date: new Date('2026-10-25T00:00:00Z') } });
    locks.set('1405-08', { isLocked: true });
    await expect(c.post('e1', ctx)).rejects.toThrow(/بسته/);
    expect(tenantDb.journalEntry.update).not.toHaveBeenCalled();
  });

  it('refuses to edit a draft into / out of a locked month', async () => {
    const c = new JournalEntriesController(okPerms(), approvals);
    const { ctx, locks } = ctxFor('OWNER', { entry: { id: 'e1', number: 3, status: 'DRAFT', date: new Date('2026-09-25T00:00:00Z') } });
    locks.set('1405-08', { isLocked: true });
    await expect(c.updateDraft('e1', dto, ctx)).rejects.toThrow(/آبان/);
  });
});
