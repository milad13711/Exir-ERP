import { describe, expect, it, vi } from 'vitest';
import { InvoicesService } from './invoices.service.js';
import { SalesReturnsService } from './sales-returns.service.js';
import { CostingService } from '../warehouse/costing.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

/**
 * ماتریس «فاکتور مستقل از حسابداری»: هر عملیات (تأیید / پرداخت / ویرایش پس از تأیید / ابطال / مرجوعی) یک بار با
 * حسابداری نصب و یک بار بدون آن. قانون: بدون حسابداری هیچ ردیف سند (JournalEntry) ساخته نمی‌شود و هیچ خطایی نیست.
 */

const ACCOUNTS: Record<string, { id: string }> = {
  '1010': { id: 'acc-cash' },
  '1020': { id: 'acc-bank' },
  '1030': { id: 'acc-ar' },
  '1040': { id: 'acc-inv' },
  '2020': { id: 'acc-tax' },
  '4010': { id: 'acc-rev' },
  '5010': { id: 'acc-cogs' },
};

function controlDb(accounting: boolean) {
  const mods = [
    { id: 'm-crm', code: 'crm', dependsOn: [], isCore: false },
    { id: 'm-acc', code: 'accounting', dependsOn: [], isCore: false },
    { id: 'm-sales', code: 'sales', dependsOn: ['crm'], isCore: false },
  ];
  const installs = [{ moduleId: 'm-crm', status: 'INSTALLED' }, { moduleId: 'm-sales', status: 'INSTALLED' }, ...(accounting ? [{ moduleId: 'm-acc', status: 'INSTALLED' }] : [])];
  return { moduleDefinition: { findMany: vi.fn(async () => mods), findUnique: vi.fn(async () => null) }, tenantModule: { findMany: vi.fn(async () => installs), findUnique: vi.fn() } };
}

function makeDb(invoice: Record<string, unknown>) {
  const journalCreates: Array<Record<string, any>> = [];
  const journalUpdates: Array<Record<string, any>> = [];
  const movements: Array<Record<string, any>> = [];
  const invoiceUpdates: Array<Record<string, any>> = [];
  const paymentCreates: Array<Record<string, any>> = [];
  const returnCreates: Array<Record<string, any>> = [];
  const db: any = {
    account: { count: vi.fn(async () => 7), findUnique: vi.fn(async ({ where }: any) => ACCOUNTS[where.code] ?? null) },
    accountingPeriodLock: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'مدیر' })) },
    moduleSetting: { findUnique: vi.fn(async () => null) },
    product: { findUnique: vi.fn(async () => ({ costPrice: 40, name: 'کالا', unit: 'عدد' })) },
    warehouse: { findFirst: vi.fn(async () => ({ id: 'wh1', isDefault: true })) },
    approvalRequest: { findFirst: vi.fn(async () => null) },
    salesInvoice: {
      findUnique: vi.fn(async () => invoice),
      findUniqueOrThrow: vi.fn(async () => ({ ...invoice, status: 'PAID', paidAmount: invoice.total, contact: { name: 'م', phone: null } })),
      update: vi.fn(async (a: any) => { invoiceUpdates.push(a.data); return { ...invoice, ...a.data, contact: { name: 'م' } }; }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    salesInvoiceLine: { deleteMany: vi.fn(async () => ({})) },
    salesPayment: { create: vi.fn(async (a: any) => { paymentCreates.push(a.data); return a.data; }), count: vi.fn(async () => 0) },
    check: { count: vi.fn(async () => 0), create: vi.fn() },
    salesReturn: { count: vi.fn(async () => 0), create: vi.fn(async (a: any) => { returnCreates.push(a.data); return { id: 'ret-1', ...a.data }; }), update: vi.fn(async () => ({})) },
    salesReturnLine: { findMany: vi.fn(async () => []) },
    shipment: { count: vi.fn(async () => 0) },
    taxInvoice: { findFirst: vi.fn(async () => null) },
    crmContact: { findUniqueOrThrow: vi.fn(async () => ({ id: 'c1', name: 'مشتری', company: null })) },
    referralConversion: { findUnique: vi.fn(async () => null) },
    stockMovement: {
      aggregate: vi.fn(async () => ({ _sum: { quantityDelta: 100 } })),
      create: vi.fn(async ({ data }: any) => { movements.push(data); return data; }),
    },
    journalEntry: {
      findUnique: vi.fn(async () => ({ id: 'je-old', date: new Date(), lines: [{ accountId: 'acc-ar', debit: 500n, credit: 0n, description: null }, { accountId: 'acc-rev', debit: 0n, credit: 500n, description: null }] })),
      create: vi.fn(async ({ data }: any) => { journalCreates.push(data); return { id: `je-${journalCreates.length}` }; }),
      update: vi.fn(async (a: any) => { journalUpdates.push(a); return {}; }),
    },
    documentRevision: { create: vi.fn(async ({ data }: any) => data) },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg))),
  };
  return { db, journalCreates, journalUpdates, movements, invoiceUpdates, paymentCreates, returnCreates };
}

const approvalsStub = { request: vi.fn(async () => ({})), closeForEntity: vi.fn(async () => undefined), registerHandler: () => {}, runOrRequest: async (_c: unknown, _i: unknown, action: () => Promise<unknown>) => ({ executed: true, result: await action() }) };

function services(accounting: boolean) {
  const control = controlDb(accounting);
  const invoices = new InvoicesService(
    { sendSms: vi.fn() } as never, { assess: vi.fn() } as never, new CostingService(), { emit: vi.fn() } as never,
    { recordPurchase: async () => {}, reversePurchase: async () => false } as never,
    { isConfigured: async () => false } as never, { issueForInvoicePaid: async () => {} } as never, control as never,
    { bookCommission: async () => {} } as never, approvalsStub as never, { getStamp: async () => ({}) } as never,
  );
  const returns = new SalesReturnsService(new CostingService(), control as never);
  return { invoices, returns };
}

const ctxOf = (db: unknown) => ({ tenantDb: db, auth: { type: 'user', sub: 'g1', role: 'OWNER' }, tenantId: 't1', tenantSlug: 'acme' }) as unknown as TenantRequestContext;
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', invoiceNo: 11, status: 'DRAFT', total: 1000, taxAmount: 0, subtotal: 1000, discount: 0, paidAmount: 0, taxRate: null, isOfficial: false,
  contactId: 'c1', dealId: null, projectId: null, dueAt: null, notes: null, paymentMethod: 'CASH', paymentBankInfo: null, revisionCount: 0,
  journalEntryId: null, accountingPosted: false, signedAt: null, signedContentHash: null, deliveryConfirmedAt: null,
  issuedAt: new Date(Date.now() - 3 * 86400_000), confirmedAt: new Date(),
  contact: { name: 'مشتری', company: null, phone: '09120000000' },
  lines: [{ id: 'l1', productId: 'p1', product: { costPrice: 40 }, description: 'کالا', quantity: 5, unitPrice: 200, lineTotal: 1000 }],
  ...over,
});

describe.each([
  ['با حسابداری', true],
  ['بدون حسابداری', false],
])('ماتریس فاکتور — %s', (_label, accounting) => {
  it('confirm: stock is issued either way; journal only with accounting', async () => {
    const { db, journalCreates, movements, invoiceUpdates } = makeDb(draft());
    const { invoices } = services(accounting);
    await invoices.confirm(ctxOf(db), 'inv-1');
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'ISSUE', quantityDelta: -5 });
    expect(journalCreates).toHaveLength(accounting ? 1 : 0);
    expect(invoiceUpdates[0]).toMatchObject({ status: 'CONFIRMED', accountingPosted: accounting, journalEntryId: accounting ? 'je-1' : null });
    if (!accounting) expect(db.account.findUnique).not.toHaveBeenCalled(); // حتی کدینگ حسابداری هم لمس نمی‌شود
  });

  it('recordPayment: payment row + status always; journal only with accounting', async () => {
    const { db, journalCreates, paymentCreates, invoiceUpdates } = makeDb(draft({ status: 'CONFIRMED', journalEntryId: accounting ? 'je-x' : null, accountingPosted: accounting }));
    const { invoices } = services(accounting);
    await invoices.recordPayment(ctxOf(db), 'inv-1', { amount: 1000, method: 'CASH' } as never);
    expect(paymentCreates).toHaveLength(1);
    expect(paymentCreates[0].accountingPosted).toBe(accounting);
    expect(invoiceUpdates[0]).toMatchObject({ paidAmount: 1000, status: 'PAID' });
    expect(journalCreates).toHaveLength(accounting ? 1 : 0);
  });

  it('cancel (manager): stock restored and CANCELLED either way; reversal only for an existing journal', async () => {
    const inv = draft({ status: 'CONFIRMED', journalEntryId: accounting ? 'je-old' : null, accountingPosted: accounting });
    const { db, journalCreates, journalUpdates, movements, invoiceUpdates } = makeDb(inv);
    const { invoices } = services(accounting);
    await invoices.cancel(ctxOf(db), 'inv-1', 'درخواست مشتری');
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'SALES_RETURN', quantityDelta: 5 });
    expect(invoiceUpdates.some((d) => d.status === 'CANCELLED')).toBe(true);
    expect(journalCreates).toHaveLength(accounting ? 1 : 0);
    expect(journalUpdates).toHaveLength(accounting ? 1 : 0);
  });

  it('editConfirmed: lines/stock updated either way; new journal only with accounting', async () => {
    const inv = draft({ status: 'CONFIRMED', journalEntryId: accounting ? 'je-old' : null, accountingPosted: accounting });
    const { db, journalCreates, movements } = makeDb(inv);
    const { invoices } = services(accounting);
    await invoices.editConfirmed(ctxOf(db), 'inv-1', { contactId: 'c1', lines: [{ productId: 'p1', description: 'کالا', quantity: 7, unitPrice: 200 }] } as never, 'اصلاح تعداد');
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'ISSUE', quantityDelta: -2 });
    // با حسابداری: سند معکوس + سند تازه؛ بدون آن: هیچ
    expect(journalCreates).toHaveLength(accounting ? 2 : 0);
  });

  it('sales return: stock back and row created either way; journal only with accounting and a posted invoice', async () => {
    const inv = draft({ status: 'PAID', paidAmount: 1000, journalEntryId: accounting ? 'je-old' : null, accountingPosted: accounting });
    const { db, journalCreates, movements, returnCreates } = makeDb(inv);
    const { returns } = services(accounting);
    await returns.create(ctxOf(db), { invoiceId: 'inv-1', reason: 'خراب', lines: [{ productId: 'p1', description: 'کالا', quantity: 2, unitPrice: 200 }] } as never);
    expect(movements).toHaveLength(1);
    expect(returnCreates[0].accountingPosted).toBe(accounting);
    expect(journalCreates).toHaveLength(accounting ? 1 : 0);
  });
});

describe('سناریوهای مرزی', () => {
  it('accounting off but invoice already has a journal: edit/cancel still keep that journal consistent', async () => {
    const inv = draft({ status: 'CONFIRMED', journalEntryId: 'je-old', accountingPosted: true });
    const { db, journalCreates, journalUpdates } = makeDb(inv);
    const { invoices } = services(false);
    await invoices.cancel(ctxOf(db), 'inv-1', 'ابطال');
    expect(journalCreates).toHaveLength(1); // سند معکوس
    expect(journalUpdates).toHaveLength(1); // سند اصلی voided
  });

  it('accounting on, invoice not yet backfilled: its sales return is deferred (no negative revenue) and flagged unposted', async () => {
    const inv = draft({ status: 'PAID', paidAmount: 1000, journalEntryId: null, accountingPosted: false });
    const { db, journalCreates, returnCreates } = makeDb(inv);
    const { returns } = services(true);
    await returns.create(ctxOf(db), { invoiceId: 'inv-1', lines: [{ productId: 'p1', description: 'کالا', quantity: 1, unitPrice: 200 }] } as never);
    expect(journalCreates).toHaveLength(0);
    expect(returnCreates[0].accountingPosted).toBe(false);
  });

  it('control-db failure falls back to accounting ON (never silently drops a financial document)', async () => {
    const { db, journalCreates } = makeDb(draft());
    const { invoices } = services(true);
    (invoices as unknown as { controlDb: unknown }).controlDb = { moduleDefinition: { findMany: vi.fn(async () => { throw new Error('down'); }) } };
    await invoices.confirm(ctxOf(db), 'inv-1');
    expect(journalCreates).toHaveLength(1);
  });

  it('policy "required": unsigned draft cannot be confirmed; signed one can', async () => {
    const required = (inv: Record<string, unknown>) => {
      const m = makeDb(inv);
      m.db.moduleSetting.findUnique = vi.fn(async () => ({ value: 'required' }));
      return m;
    };
    const { invoices } = services(false);
    const unsigned = required(draft());
    await expect(invoices.confirm(ctxOf(unsigned.db), 'inv-1')).rejects.toThrow(/امضا/);
    expect(unsigned.movements).toHaveLength(0);
    const { invoiceContentHash } = await import('./invoice-signing.js');
    const base = draft();
    const signed = required(draft({ signedAt: new Date(), signedContentHash: invoiceContentHash(base as never) }));
    await expect(invoices.confirm(ctxOf(signed.db), 'inv-1')).resolves.toBeTruthy();
    expect(signed.movements).toHaveLength(1);
  });

  it('policy "required": a signature made stale by later content changes blocks issuing', async () => {
    const { invoices } = services(false);
    const stale = makeDb(draft({ signedAt: new Date(), signedContentHash: 'old-hash' }));
    stale.db.moduleSetting.findUnique = vi.fn(async () => ({ value: 'required' }));
    await expect(invoices.confirm(ctxOf(stale.db), 'inv-1')).rejects.toThrow(/بی‌اعتبار/);
  });
});
