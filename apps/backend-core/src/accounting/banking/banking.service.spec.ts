import { describe, expect, it, vi } from 'vitest';
import { BankingService } from './banking.service.js';
import { BankingController } from './banking.controller.js';
import { claimLeaf, syncLeafWithCheck } from './cheque-leaf.util.js';

function makeDb(over: Record<string, any> = {}) {
  const created: any[] = [];
  const db: any = {
    account: {
      findUnique: vi.fn(async ({ where }: any) => (where.code ? { id: `acc-${where.code}`, code: where.code, type: 'ASSET' } : { id: where.id, code: 'X', type: 'ASSET' })),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: 'new-acc', ...data })),
      count: vi.fn(async () => 1),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id, code: '1020-01' })),
    },
    bankAccount: { findUnique: vi.fn(async () => ({ id: 'b1', name: 'ملی', isActive: true, linkedAccountId: 'acc-bank' })), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => ({ id: 'b1', ...data })) },
    cashBox: { findUnique: vi.fn(async () => ({ id: 'c1', name: 'صندوق اصلی', isActive: true, linkedAccountId: 'acc-cash' })), findFirst: vi.fn(async () => null) },
    crmContact: { findUnique: vi.fn(async () => ({ id: 'ct1', name: 'مشتری' })) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1' })) },
    journalLine: { aggregate: vi.fn(async () => ({ _sum: { debit: 1_000_000n, credit: 0n } })) },
    journalEntry: {
      create: vi.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'je1', number: 7 };
      }),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    bankStatementLine: { count: vi.fn(async () => over.reconciled ?? 0) },
    accountingPeriodLock: { findUnique: vi.fn(async () => over.locked ? { isLocked: true } : null) },
    bankTransaction: { create: vi.fn(async ({ data }: any) => ({ id: 'bt1', number: 12, ...data })), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []) },
    partyTransaction: { create: vi.fn(), deleteMany: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return { db, created };
}
const ctxOf = (db: any) => ({ tenantDb: db, auth: { type: 'user', sub: 'g1', role: 'OWNER' } }) as any;

describe('BankingService.createTransaction', () => {
  const svc = new BankingService();

  it('receipt from a customer posts Dr bank / Cr receivable (1030) and records the party transaction', async () => {
    const { db, created } = makeDb();
    const r = await svc.createTransaction(ctxOf(db), { type: 'RECEIPT', date: '2026-10-25', amount: 250_000, bankAccountId: 'b1', contactId: 'ct1' } as any);
    expect(r.journalNumber).toBe(7);
    const lines = created[0].lines.create;
    expect(lines[0]).toMatchObject({ accountId: 'acc-bank', debit: 250_000n, credit: 0n });
    expect(lines[1]).toMatchObject({ accountId: 'acc-1030', credit: 250_000n });
    expect(db.partyTransaction.create).toHaveBeenCalled();
    expect(db.activityLog.create).toHaveBeenCalled();
  });

  it('refuses to post into a locked period and creates nothing', async () => {
    const { db } = makeDb({ locked: true });
    await expect(svc.createTransaction(ctxOf(db), { type: 'RECEIPT', date: '2026-10-25', amount: 5, bankAccountId: 'b1', counterAccountId: 'acc-x' } as any)).rejects.toThrow(/بسته/);
    expect(db.bankTransaction.create).not.toHaveBeenCalled();
  });

  it('requires exactly one of contact / counter account, and exactly one holder', async () => {
    const { db } = makeDb();
    await expect(svc.createTransaction(ctxOf(db), { type: 'RECEIPT', date: '2026-10-25', amount: 5, bankAccountId: 'b1' } as any)).rejects.toThrow(/فقط یکی/);
    await expect(svc.createTransaction(ctxOf(db), { type: 'RECEIPT', date: '2026-10-25', amount: 5, bankAccountId: 'b1', cashBoxId: 'c1', contactId: 'ct1' } as any)).rejects.toThrow(/دقیقاً یکی/);
  });

  it('transfer between bank and cash box posts Dr destination / Cr source; cannot go to itself', async () => {
    const { db, created } = makeDb();
    await svc.createTransaction(ctxOf(db), { type: 'TRANSFER', date: '2026-10-25', amount: 900, bankAccountId: 'b1', toCashBoxId: 'c1' } as any);
    const l = created[0].lines.create;
    expect(l[0]).toMatchObject({ accountId: 'acc-cash', debit: 900n });
    expect(l[1]).toMatchObject({ accountId: 'acc-bank', credit: 900n });
    db.cashBox.findUnique.mockResolvedValue({ id: 'c1', name: 'x', isActive: true, linkedAccountId: 'acc-bank' });
    await expect(svc.createTransaction(ctxOf(db), { type: 'TRANSFER', date: '2026-10-25', amount: 900, bankAccountId: 'b1', toCashBoxId: 'c1' } as any)).rejects.toThrow(/یکی/);
  });

  it('blocks a cash-box payment that exceeds the box balance', async () => {
    const { db } = makeDb();
    await expect(svc.createTransaction(ctxOf(db), { type: 'PAYMENT', date: '2026-10-25', amount: 2_000_000, cashBoxId: 'c1', counterAccountId: 'acc-e' } as any)).rejects.toThrow(/کافی نیست/);
  });

  it('inactive bank account is refused', async () => {
    const { db } = makeDb();
    db.bankAccount.findUnique.mockResolvedValue({ id: 'b1', name: 'ملی', isActive: false, linkedAccountId: 'acc-bank' });
    await expect(svc.createTransaction(ctxOf(db), { type: 'RECEIPT', date: '2026-10-25', amount: 5, bankAccountId: 'b1', counterAccountId: 'a' } as any)).rejects.toThrow(/غیرفعال/);
  });
});

describe('BankingService.createBank validation', () => {
  const svc = new BankingService();
  it('rejects an invalid Sheba and an invalid card before touching the DB', async () => {
    const { db } = makeDb();
    await expect(svc.createBank(ctxOf(db), { name: 'ملی', sheba: 'IR000000000000000000000000' } as any)).rejects.toThrow(/شبا/);
    await expect(svc.createBank(ctxOf(db), { name: 'ملی', cardNumber: '1234567812345678' } as any)).rejects.toThrow(/کارت/);
    expect(db.bankAccount.create).not.toHaveBeenCalled();
  });
  it('opening balance in a locked month is refused', async () => {
    const { db } = makeDb({ locked: true });
    await expect(svc.createBank(ctxOf(db), { name: 'ملی', openingBalance: 100, openingDate: '2026-10-25' } as any)).rejects.toThrow(/بسته/);
  });
});

describe('BankingService.voidTransaction', () => {
  it('reverses via a new entry (no delete) and marks VOIDED; second void is a conflict', async () => {
    const svc = new BankingService();
    const { db, created } = makeDb();
    db.bankTransaction.findUnique.mockResolvedValue({ id: 'bt1', number: 12, status: 'POSTED', journalEntryId: 'je0' });
    db.journalEntry.findUnique.mockResolvedValue({ id: 'je0', number: 5, status: 'POSTED', voidedAt: null, reversalOfId: null, date: new Date('2026-10-25'), lines: [{ accountId: 'a', debit: 10n, credit: 0n }, { accountId: 'b', debit: 0n, credit: 10n }] });
    await svc.voidTransaction(ctxOf(db), 'bt1', 'اشتباه');
    expect(created[0].lines.create[0]).toMatchObject({ accountId: 'a', debit: 0n, credit: 10n });
    expect(db.bankTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bt1', status: 'POSTED' }, data: expect.objectContaining({ status: 'VOIDED' }) }));
    expect(db.journalEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ voidedAt: null }) }));
    db.bankTransaction.findUnique.mockResolvedValue({ id: 'bt1', number: 12, status: 'VOIDED', journalEntryId: 'je0' });
    await expect(svc.voidTransaction(ctxOf(db), 'bt1', 'دوباره')).rejects.toMatchObject({ status: 409 });
  });
});

describe('BankingService.voidTransaction races / reconciliation', () => {
  const entry = { id: 'je0', number: 5, status: 'POSTED', voidedAt: null, reversalOfId: null, date: new Date('2026-10-25'), lines: [{ accountId: 'a', debit: 10n, credit: 0n }, { accountId: 'b', debit: 0n, credit: 10n }] };
  it('lost claim on the bank transaction → 409 and no reversal entry is created', async () => {
    const { db, created } = makeDb();
    db.bankTransaction.findUnique.mockResolvedValue({ id: 'bt1', number: 12, status: 'POSTED', journalEntryId: 'je0' });
    db.journalEntry.findUnique.mockResolvedValue(entry);
    db.bankTransaction.updateMany.mockResolvedValue({ count: 0 });
    await expect(new BankingService().voidTransaction(ctxOf(db), 'bt1', 'x')).rejects.toMatchObject({ status: 409 });
    expect(created).toHaveLength(0);
  });
  it('lost claim on the journal entry → 409 and no reversal entry is created', async () => {
    const { db, created } = makeDb();
    db.bankTransaction.findUnique.mockResolvedValue({ id: 'bt1', number: 12, status: 'POSTED', journalEntryId: 'je0' });
    db.journalEntry.findUnique.mockResolvedValue(entry);
    db.journalEntry.updateMany.mockResolvedValue({ count: 0 });
    await expect(new BankingService().voidTransaction(ctxOf(db), 'bt1', 'x')).rejects.toMatchObject({ status: 409 });
    expect(created).toHaveLength(0);
  });
  it('refuses to void when a journal line is already reconciled with a bank statement', async () => {
    const { db, created } = makeDb({ reconciled: 1 });
    db.bankTransaction.findUnique.mockResolvedValue({ id: 'bt1', number: 12, status: 'POSTED', journalEntryId: 'je0' });
    db.journalEntry.findUnique.mockResolvedValue(entry);
    await expect(new BankingService().voidTransaction(ctxOf(db), 'bt1', 'x')).rejects.toThrow(/تطبیق/);
    expect(created).toHaveLength(0);
  });
});

describe('BankingService.listTransactions query coercion', () => {
  it('rejects non-string filters (object/array injection)', async () => {
    const { db } = makeDb();
    const svc = new BankingService();
    for (const k of ['type', 'status', 'bankAccountId', 'cashBoxId']) {
      await expect(svc.listTransactions(ctxOf(db), { [k]: { contains: 'x' } } as any)).rejects.toMatchObject({ status: 400 });
      await expect(svc.listTransactions(ctxOf(db), { [k]: ['a', 'b'] } as any)).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe('BankingController permissions', () => {
  it('create/edit/void map to create/edit/delete; reads need view-all', async () => {
    const perms: any = { assertViewAll: vi.fn(), assertCreate: vi.fn(), assertEdit: vi.fn(), assertDelete: vi.fn(), assertView: vi.fn() };
    const banking: any = { listBanks: vi.fn(), createBank: vi.fn(), updateBank: vi.fn(), voidTransaction: vi.fn(), createTransaction: vi.fn(), setLeafStatus: vi.fn() };
    const c = new BankingController(perms, banking);
    const ctx = {} as any;
    await c.banks(ctx);
    expect(perms.assertViewAll).toHaveBeenCalledWith(ctx, 'accounting');
    await c.createBank({} as any, ctx);
    expect(perms.assertCreate).toHaveBeenCalled();
    await c.updateBank('b', {} as any, ctx);
    expect(perms.assertEdit).toHaveBeenCalled();
    await c.voidTransaction('t', { reason: ' دلیل ' }, ctx);
    expect(perms.assertDelete).toHaveBeenCalled();
    expect(banking.voidTransaction).toHaveBeenCalledWith(ctx, 't', 'دلیل');
    perms.assertCreate.mockRejectedValueOnce(new Error('no'));
    await expect(c.createTransaction({} as any, ctx)).rejects.toThrow('no');
    expect(banking.createTransaction).not.toHaveBeenCalled();
  });
});

describe('cheque leaf integration', () => {
  const book = { id: 'bk', status: 'ACTIVE', bankAccountId: 'b1', bankAccount: { isActive: true, bankName: 'ملی' } };
  it('claims the lowest unused serial and links the check', async () => {
    const db: any = {
      chequeLeaf: {
        findFirst: vi.fn(async () => ({ id: 'l5', serial: 105, status: 'UNUSED', chequeBookId: 'bk', chequeBook: book })),
        findUnique: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 3),
      },
      chequeBook: { findUnique: vi.fn(async () => ({ status: 'ACTIVE' })), update: vi.fn() },
    };
    const r = await claimLeaf(db, { chequeBookId: 'bk' }, 'chk1');
    expect(r).toMatchObject({ leafId: 'l5', serial: 105, bankName: 'ملی' });
    expect(db.chequeLeaf.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { serial: 'asc' } }));
    expect(db.chequeLeaf.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'l5', status: 'UNUSED' }, data: expect.objectContaining({ status: 'ISSUED', linkedCheckId: 'chk1' }) }));
  });

  it('a chosen leaf that is already used is a conflict; exhausted book is a conflict', async () => {
    const db: any = {
      chequeLeaf: { findUnique: vi.fn(async () => ({ id: 'l1', serial: 1, status: 'ISSUED', chequeBookId: 'bk', chequeBook: book })), findFirst: vi.fn(async () => null), updateMany: vi.fn(), count: vi.fn() },
      chequeBook: { findUnique: vi.fn(), update: vi.fn() },
    };
    await expect(claimLeaf(db, { chequeLeafId: 'l1' }, 'c')).rejects.toMatchObject({ status: 409 });
    await expect(claimLeaf(db, { chequeBookId: 'bk' }, 'c')).rejects.toThrow(/نمانده/);
  });

  it('a lost race (updateMany count 0) does not double-issue', async () => {
    const db: any = {
      chequeLeaf: { findUnique: vi.fn(async () => ({ id: 'l1', serial: 1, status: 'UNUSED', chequeBookId: 'bk', chequeBook: book })), updateMany: vi.fn(async () => ({ count: 0 })), count: vi.fn() },
      chequeBook: { findUnique: vi.fn(), update: vi.fn() },
    };
    await expect(claimLeaf(db, { chequeLeafId: 'l1' }, 'c')).rejects.toMatchObject({ status: 409 });
  });

  it('clearing / bouncing a check updates its leaf', async () => {
    const db: any = { chequeLeaf: { updateMany: vi.fn() }, chequeBook: {} };
    await syncLeafWithCheck(db, 'chk1', 'CLEARED');
    expect(db.chequeLeaf.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { linkedCheckId: 'chk1' }, data: expect.objectContaining({ status: 'CLEARED' }) }));
    await syncLeafWithCheck(db, 'chk1', 'BOUNCED');
    expect(db.chequeLeaf.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'BOUNCED' }) }));
    db.chequeLeaf.updateMany.mockClear();
    await syncLeafWithCheck(db, 'chk1', 'ENDORSED');
    expect(db.chequeLeaf.updateMany).not.toHaveBeenCalled();
  });
});
