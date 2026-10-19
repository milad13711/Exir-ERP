import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InvoicesService } from './invoices.service.js';
import { CostingService } from '../warehouse/costing.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const ACCOUNTS: Record<string, { id: string; code: string }> = {
  '1030': { id: 'acc-ar', code: '1030' },
  '1040': { id: 'acc-inv', code: '1040' },
  '2020': { id: 'acc-tax', code: '2020' },
  '4010': { id: 'acc-rev', code: '4010' },
  '5010': { id: 'acc-cogs', code: '5010' },
};

type Line = { productId: string | null; description: string; quantity: number; unitPrice: number };

function baseInvoice(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1', invoiceNo: 7, status: 'CONFIRMED', paidAmount: 0, isOfficial: false, taxRate: null, taxAmount: 0,
    contactId: 'c1', dealId: null, projectId: null, dueAt: null, discount: 0, subtotal: 500, total: 500, notes: null,
    paymentMethod: 'CASH', paymentBankInfo: null, journalEntryId: 'je-old', revisionCount: 0,
    signedAt: null, deliveryConfirmedAt: null,
    contact: { name: 'مشتری', company: null },
    lines: [{ id: 'l1', productId: 'p1', description: 'کالا', quantity: 5, unitPrice: 100 }] as Array<Line & { id: string }>,
    ...over,
  };
}

function setup(opts: { invoice?: ReturnType<typeof baseInvoice>; counts?: Partial<Record<'payments' | 'checks' | 'returns' | 'shipments', number>>; stock?: number; guardCount?: number; taxLocked?: boolean; costPrice?: number } = {}) {
  const invoice = opts.invoice ?? baseInvoice();
  const counts = { payments: 0, checks: 0, returns: 0, shipments: 0, ...opts.counts };
  const journalCreates: Array<Record<string, any>> = [];
  const journalUpdates: Array<Record<string, any>> = [];
  const movements: Array<Record<string, any>> = [];
  const revisions: Array<Record<string, any>> = [];
  const invoiceUpdates: Array<Record<string, any>> = [];
  const guardCalls: Array<Record<string, any>> = [];
  const db: any = {
    account: { count: vi.fn(async () => 5), findUnique: vi.fn(async ({ where }: any) => ACCOUNTS[where.code] ?? null) },
    salesInvoice: {
      findUnique: vi.fn(async () => invoice),
      findUniqueOrThrow: vi.fn(async () => invoice),
      updateMany: vi.fn(async (args: any) => { guardCalls.push(args); return { count: opts.guardCount ?? 1 }; }),
      update: vi.fn(async (args: any) => { invoiceUpdates.push(args.data); return invoice; }),
    },
    salesInvoiceLine: { deleteMany: vi.fn(async () => ({})) },
    salesPayment: { count: vi.fn(async () => counts.payments) },
    check: { count: vi.fn(async () => counts.checks) },
    salesReturn: { count: vi.fn(async () => counts.returns) },
    shipment: { count: vi.fn(async () => counts.shipments) },
    taxInvoice: { findFirst: vi.fn(async (a: any) => (opts.taxLocked && a.where.status !== 'ACCEPTED' ? { id: 't' } : null)) },
    crmContact: { findUniqueOrThrow: vi.fn(async () => ({ id: 'c1', name: 'مشتری', company: null })) },
    warehouse: { findFirst: vi.fn(async () => ({ id: 'wh1', isDefault: true })) },
    stockMovement: {
      aggregate: vi.fn(async () => ({ _sum: { quantityDelta: opts.stock ?? 100 } })),
      create: vi.fn(async ({ data }: any) => { movements.push(data); return data; }),
    },
    product: {
      findUnique: vi.fn(async () => ({ name: 'کالا', unit: 'عدد', costPrice: opts.costPrice ?? 40 })),
    },
    moduleSetting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'مدیر' })) },
    journalEntry: {
      findUnique: vi.fn(async () => ({
        id: 'je-old',
        lines: [
          { accountId: 'acc-ar', debit: 500n, credit: 0n, description: null },
          { accountId: 'acc-rev', debit: 0n, credit: 500n, description: null },
          { accountId: 'acc-cogs', debit: 200n, credit: 0n, description: null },
          { accountId: 'acc-inv', debit: 0n, credit: 200n, description: null },
        ],
      })),
      create: vi.fn(async ({ data }: any) => { journalCreates.push(data); return { id: `je-${journalCreates.length}` }; }),
      update: vi.fn(async (args: any) => { journalUpdates.push(args); return {}; }),
    },
    documentRevision: { create: vi.fn(async ({ data }: any) => { revisions.push(data); return data; }) },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg))),
  };
  const gateway = { isConfigured: async () => false };
  const service = new InvoicesService(
    { sendSms: vi.fn() } as never, { assess: vi.fn() } as never, new CostingService(), { emit: vi.fn() } as never, { reversePurchase: vi.fn(async () => false) } as never,
    gateway as never, {} as never, { moduleDefinition: { findUnique: vi.fn() }, tenantModule: { findUnique: vi.fn() } } as never, {} as never,
    { registerHandler: () => {}, closeForEntity: vi.fn(), request: vi.fn(), runOrRequest: vi.fn() } as never, {} as never,
  );
  const ctx = { tenantDb: db, auth: { type: 'user', sub: 'g1', role: 'OWNER' }, tenantId: 't1' } as unknown as TenantRequestContext;
  return { service, ctx, db, journalCreates, journalUpdates, movements, revisions, invoiceUpdates, guardCalls };
}

const dto = (lines: Line[], extra: Record<string, unknown> = {}) => ({ contactId: 'c1', lines, ...extra }) as never;
const sum = (ls: Array<{ debit: bigint; credit: bigint }>) => ({ d: ls.reduce((s, l) => s + l.debit, 0n), c: ls.reduce((s, l) => s + l.credit, 0n) });

describe('InvoicesService.editConfirmed — accounting reversal + stock', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the old journal, voids it, posts a new balanced one and re-links the invoice', async () => {
    const t = setup();
    // quantity 5 → 8 at 100 each = 800
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 8, unitPrice: 100 }]), 'اصلاح تعداد');

    expect(t.journalCreates).toHaveLength(2);
    const [reversal, fresh] = t.journalCreates;
    expect(reversal.reversalOfId).toBe('je-old');
    // reversal is the exact mirror of the original
    const orig = [{ debit: 500n, credit: 0n }, { debit: 0n, credit: 500n }, { debit: 200n, credit: 0n }, { debit: 0n, credit: 200n }];
    expect(sum(reversal.lines.create).d).toBe(sum(orig).c);
    expect(sum([...orig, ...reversal.lines.create]).d).toBe(sum([...orig, ...reversal.lines.create]).c);
    // original is voided, never deleted
    expect(t.journalUpdates[0]).toMatchObject({ where: { id: 'je-old' }, data: { voidReason: expect.stringContaining('اصلاح تعداد') } });
    // new entry balanced: AR 800 / revenue 800, COGS 8 * costPrice(40)=320 / inventory 320
    const f = sum(fresh.lines.create);
    expect(f.d).toBe(f.c);
    expect(f.d).toBe(800n + 320n);
    expect(t.invoiceUpdates.at(-1)).toMatchObject({ total: 800, subtotal: 800, journalEntryId: 'je-2' });
  });

  it('posts only the net stock difference (issue 3 more units) with the reason as note', async () => {
    const t = setup();
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 8, unitPrice: 100 }]), 'اصلاح تعداد');
    expect(t.movements).toHaveLength(1);
    expect(t.movements[0]).toMatchObject({ productId: 'p1', type: 'ISSUE', quantityDelta: -3, note: 'اصلاح تعداد' });
  });

  it('returns stock to the warehouse when quantity drops', async () => {
    const t = setup();
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 2, unitPrice: 100 }]), 'کاهش');
    expect(t.movements[0]).toMatchObject({ type: 'SALES_RETURN', quantityDelta: 3 });
  });

  it('price-only edit moves no stock but still re-posts the journal', async () => {
    const t = setup();
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 5, unitPrice: 120 }]), 'اصلاح قیمت');
    expect(t.movements).toHaveLength(0);
    expect(t.journalCreates).toHaveLength(2);
  });

  it('records a revision with reason, user, before/after and a readable diff, and bumps the optimistic lock', async () => {
    const t = setup();
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 8, unitPrice: 100 }]), 'اصلاح تعداد');
    expect(t.revisions[0]).toMatchObject({ entityType: 'sales_invoice', entityId: 'inv-1', revisionNo: 1, action: 'EDIT', reason: 'اصلاح تعداد', userName: 'مدیر' });
    expect(t.revisions[0].changes.map((c: any) => c.field)).toEqual(expect.arrayContaining(['مبلغ نهایی', 'قلم «کالا»']));
    expect(t.guardCalls[0].where).toMatchObject({ id: 'inv-1', status: 'CONFIRMED', paidAmount: 0, revisionCount: 0 });
  });

  it('whole operation runs in one interactive transaction', async () => {
    const t = setup();
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 8, unitPrice: 100 }]), 'دلیل');
    expect(t.db.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof t.db.$transaction.mock.calls[0][0]).toBe('function');
  });

  it('adds tax liability line for an official invoice', async () => {
    const t = setup({ invoice: baseInvoice({ isOfficial: true, taxRate: 9, taxAmount: 45, total: 545 }) });
    await t.service.editConfirmed(t.ctx, 'inv-1', dto([{ productId: 'p1', description: 'کالا', quantity: 5, unitPrice: 200 }], { taxRate: 10 }), 'نرخ');
    const fresh = t.journalCreates[1].lines.create;
    expect(fresh.find((l: any) => l.accountId === 'acc-tax')?.credit).toBe(100n);
    expect(sum(fresh).d).toBe(sum(fresh).c);
  });
});

describe('InvoicesService.editConfirmed — refusals write nothing', () => {
  const edit = (t: ReturnType<typeof setup>, lines: Line[] = [{ productId: 'p1', description: 'کالا', quantity: 8, unitPrice: 100 }], extra: Record<string, unknown> = {}) =>
    t.service.editConfirmed(t.ctx, 'inv-1', dto(lines, extra), 'دلیل');
  const untouched = (t: ReturnType<typeof setup>) => {
    expect(t.db.$transaction).not.toHaveBeenCalled();
    expect(t.journalCreates).toHaveLength(0);
    expect(t.movements).toHaveLength(0);
  };

  it.each([
    ['paid invoice', { invoice: baseInvoice({ status: 'PAID', paidAmount: 500 }) }, /برگشت از فروش/],
    ['invoice with payments', { counts: { payments: 1 } }, /پرداخت دارد/],
    ['invoice with cheques', { counts: { checks: 1 } }, /چک/],
    ['invoice with returns', { counts: { returns: 1 } }, /مرجوعی/],
    ['delivered invoice', { invoice: baseInvoice({ deliveryConfirmedAt: new Date() }) }, /تحویل/],
    ['signed invoice', { invoice: baseInvoice({ signedAt: new Date() }) }, /امضا/],
    ['invoice with an active shipment (dispatch)', { counts: { shipments: 1 } }, /بار/],
    ['tax-locked invoice (moodian)', { taxLocked: true }, /مودیان/],
    ['draft invoice', { invoice: baseInvoice({ status: 'DRAFT' }) }, /پیش‌نویس/],
    ['cancelled invoice', { invoice: baseInvoice({ status: 'CANCELLED' }) }, /باطل/],
  ])('refuses: %s', async (_n, opts, msg) => {
    const t = setup(opts as never);
    await expect(edit(t)).rejects.toThrow(msg);
    untouched(t);
  });

  it('refuses to flip official/unofficial', async () => {
    const t = setup();
    await expect(edit(t, undefined, { isOfficial: true })).rejects.toThrow(/رسمی/);
    untouched(t);
  });

  it('refuses a no-op edit', async () => {
    const t = setup();
    await expect(edit(t, [{ productId: 'p1', description: 'کالا', quantity: 5, unitPrice: 100 }])).rejects.toThrow(/هیچ تغییری/);
    untouched(t);
  });

  it('refuses when extra units are not in stock (would go negative)', async () => {
    const t = setup({ stock: 2 });
    await expect(edit(t)).rejects.toThrow(/موجودی/);
    untouched(t);
  });

  it('does not require stock when quantity is reduced', async () => {
    const t = setup({ stock: 0 });
    await expect(edit(t, [{ productId: 'p1', description: 'کالا', quantity: 1, unitPrice: 100 }])).resolves.toBeDefined();
  });

  it('fails with a conflict (and no side effects beyond the tx) when a payment/edit raced in', async () => {
    const t = setup({ guardCount: 0 });
    await expect(edit(t)).rejects.toThrow(/هم‌زمان/);
    expect(t.journalCreates).toHaveLength(0);
    expect(t.movements).toHaveLength(0);
    expect(t.revisions).toHaveLength(0);
  });

  it('rejects a discount larger than the subtotal', async () => {
    const t = setup();
    await expect(edit(t, undefined, { discount: 99999 })).rejects.toThrow(/تخفیف/);
    untouched(t);
  });
});

describe('InvoicesService.cancel — void rules', () => {
  it('a delivered invoice cannot be voided (a sales return is the right path)', async () => {
    const t = setup({ invoice: baseInvoice({ deliveryConfirmedAt: new Date() }) });
    await expect(t.service.cancel(t.ctx, 'inv-1', 'دلیل')).rejects.toThrow(/برگشت از فروش/);
  });
  it('an invoice with an active shipment cannot be voided', async () => {
    const t = setup({ counts: { shipments: 1 } });
    await expect(t.service.cancel(t.ctx, 'inv-1', 'دلیل')).rejects.toThrow(/بار/);
  });
});

describe('InvoicesService.cancel — executed void (manager)', () => {
  it('reverses the journal, restores every line to stock, marks CANCELLED and records a VOID revision', async () => {
    const invoice = baseInvoice({ lines: [{ id: 'l1', productId: 'p1', description: 'کالا', quantity: 5, unitPrice: 100 }, { id: 'l2', productId: 'p2', description: 'دیگر', quantity: 1, unitPrice: 0 }] });
    const t = setup({ invoice });
    ((t.service as unknown as { approvals: { runOrRequest: ReturnType<typeof vi.fn> } }).approvals).runOrRequest.mockImplementation(
      async (_c: unknown, _i: unknown, action: () => Promise<unknown>) => ({ executed: true, result: await action() }),
    );
    const res = await t.service.cancel(t.ctx, 'inv-1', 'اشتباه ثبت شد');
    expect(res).toEqual({ success: true, pendingApproval: false });
    expect(t.journalCreates[0]).toMatchObject({ reversalOfId: 'je-old' });
    expect(t.journalUpdates[0].data.voidReason).toBe('اشتباه ثبت شد');
    expect(t.movements.map((m) => [m.productId, m.type, m.quantityDelta])).toEqual([['p1', 'SALES_RETURN', 5], ['p2', 'SALES_RETURN', 1]]);
    expect(t.invoiceUpdates.at(-1)).toMatchObject({ status: 'CANCELLED', cancelReason: 'اشتباه ثبت شد' });
    expect(t.revisions[0]).toMatchObject({ action: 'VOID', reason: 'اشتباه ثبت شد', revisionNo: 1 });
  });
});
