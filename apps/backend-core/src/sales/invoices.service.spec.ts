import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InvoicesService } from './invoices.service.js';
import { CostingService } from '../warehouse/costing.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const ACCOUNTS_BY_CODE: Record<string, { id: string; code: string }> = {
  '1010': { id: 'acc-cash', code: '1010' },
  '1020': { id: 'acc-bank', code: '1020' },
  '1030': { id: 'acc-ar', code: '1030' },
  '1040': { id: 'acc-inventory', code: '1040' },
  '2020': { id: 'acc-tax', code: '2020' },
  '4010': { id: 'acc-revenue', code: '4010' },
  '5010': { id: 'acc-cogs', code: '5010' },
};

function makeTenantDb(overrides: Record<string, unknown> = {}) {
  const journalEntryCalls: Array<Record<string, unknown>> = [];
  const salesPaymentCalls: Array<Record<string, unknown>> = [];
  const checkCalls: Array<Record<string, unknown>> = [];
  const stockMovementCalls: Array<Record<string, unknown>> = [];
  const invoiceUpdateCalls: Array<Record<string, unknown>> = [];

  const tenantDb = {
    account: {
      count: vi.fn().mockResolvedValue(11),
      findUnique: vi.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(ACCOUNTS_BY_CODE[where.code] ?? null),
      ),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', name: 'تستر' }) },
    moduleSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    salesInvoice: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        invoiceUpdateCalls.push(args.data);
        return Promise.resolve({ id: 'inv-1', ...args.data });
      }),
    },
    journalEntry: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        journalEntryCalls.push(args.data);
        return Promise.resolve({ id: 'je-1', ...args.data });
      }),
    },
    stockMovement: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        stockMovementCalls.push(args.data);
        return Promise.resolve({ id: 'sm-1' });
      }),
    },
    warehouse: {
      findFirst: vi.fn().mockResolvedValue({ id: 'wh-1', name: 'انبار مرکزی', isDefault: true }),
    },
    salesPayment: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        salesPaymentCalls.push(args.data);
        return Promise.resolve({ id: 'pay-1', ...args.data });
      }),
    },
    check: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        checkCalls.push(args.data);
        return Promise.resolve({ id: 'chk-1', ...args.data });
      }),
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    ...overrides,
  };

  return { tenantDb, journalEntryCalls, salesPaymentCalls, checkCalls, stockMovementCalls, invoiceUpdateCalls };
}

function makeCtx(tenantDb: unknown): TenantRequestContext {
  return { tenantDb, auth: { type: 'user', sub: 'global-1' }, tenantId: 't1' } as unknown as TenantRequestContext;
}

function sumLines(lines: Array<{ debit: bigint; credit: bigint }>) {
  return {
    debit: lines.reduce((s, l) => s + l.debit, 0n),
    credit: lines.reduce((s, l) => s + l.credit, 0n),
  };
}

// CreditScoreService isn't exercised by these tests (getCreditWarning is only
// hit via detail()/create(), not confirm()/recordPayment()) — a minimal stub
// is enough to satisfy the constructor.
const creditScoreStub = { assess: vi.fn() };
const smsStub = { isConfigured: vi.fn().mockReturnValue(false), sendSms: vi.fn() };
const automationStub = { emit: vi.fn() };

describe('InvoicesService.confirm — double-entry posting', () => {
  let service: InvoicesService;
  beforeEach(() => {
    service = new InvoicesService(smsStub as never, creditScoreStub as never, new CostingService(), automationStub as never, { recordPurchase: async () => {} } as never, { isConfigured: false, requestPayment: vi.fn(), verifyPayment: vi.fn() } as never);
  });

  it('posts a balanced Dr AR / Cr Revenue entry for a simple invoice with no tax or COGS', async () => {
    const { tenantDb, journalEntryCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      invoiceNo: 1,
      status: 'DRAFT',
      total: 1_000_000,
      taxAmount: 0,
      lines: [{ productId: null, product: null, quantity: 1 }],
    });

    await service.confirm(makeCtx(tenantDb), 'inv-1');

    expect(journalEntryCalls).toHaveLength(1);
    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string; debit: bigint; credit: bigint }> }).create;
    const { debit, credit } = sumLines(lines);
    expect(debit).toBe(credit); // fundamental double-entry invariant
    expect(debit).toBe(1_000_000n);
    expect(lines).toEqual([
      { accountId: 'acc-ar', debit: 1_000_000n, credit: 0n },
      { accountId: 'acc-revenue', debit: 0n, credit: 1_000_000n },
    ]);
  });

  it('splits tax into a separate Tax Payable credit, not revenue', async () => {
    const { tenantDb, journalEntryCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      invoiceNo: 2,
      status: 'DRAFT',
      total: 11_000_000, // 10,000,000 + 10% tax
      taxAmount: 1_000_000,
      lines: [{ productId: null, product: null, quantity: 1 }],
    });

    await service.confirm(makeCtx(tenantDb), 'inv-1');

    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string; debit: bigint; credit: bigint }> }).create;
    const { debit, credit } = sumLines(lines);
    expect(debit).toBe(credit);
    expect(lines).toContainEqual({ accountId: 'acc-ar', debit: 11_000_000n, credit: 0n });
    expect(lines).toContainEqual({ accountId: 'acc-revenue', debit: 0n, credit: 10_000_000n });
    expect(lines).toContainEqual({ accountId: 'acc-tax', debit: 0n, credit: 1_000_000n });
  });

  it('adds a Dr COGS / Cr Inventory pair sized to the product cost basis', async () => {
    const { tenantDb, journalEntryCalls, stockMovementCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      invoiceNo: 3,
      status: 'DRAFT',
      total: 5_000_000,
      taxAmount: 0,
      lines: [{ productId: 'p1', product: { costPrice: 2_000_000 }, quantity: 2 }],
    });
    tenantDb.product.findUnique.mockResolvedValue({ costPrice: 2_000_000 });

    await service.confirm(makeCtx(tenantDb), 'inv-1');

    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string; debit: bigint; credit: bigint }> }).create;
    const { debit, credit } = sumLines(lines);
    expect(debit).toBe(credit); // still balanced even with the extra COGS pair
    expect(lines).toContainEqual({ accountId: 'acc-cogs', debit: 4_000_000n, credit: 0n });
    expect(lines).toContainEqual({ accountId: 'acc-inventory', debit: 0n, credit: 4_000_000n });
    expect(stockMovementCalls).toHaveLength(1);
    expect(stockMovementCalls[0]).toMatchObject({ productId: 'p1', type: 'ISSUE', quantityDelta: -2 });
  });

  it('refuses to confirm a non-DRAFT invoice', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue({ id: 'inv-1', status: 'CONFIRMED', lines: [] });
    await expect(service.confirm(makeCtx(tenantDb), 'inv-1')).rejects.toThrow();
  });
});

describe('InvoicesService.recordPayment', () => {
  let service: InvoicesService;
  beforeEach(() => {
    service = new InvoicesService(smsStub as never, creditScoreStub as never, new CostingService(), automationStub as never, { recordPurchase: async () => {} } as never, { isConfigured: false, requestPayment: vi.fn(), verifyPayment: vi.fn() } as never);
  });

  function invoiceStub(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      invoiceNo: 5,
      status: 'CONFIRMED',
      total: 1_000_000,
      paidAmount: 0,
      contactId: 'contact-1',
      contact: { name: 'مشتری تست', phone: '09120000000' },
      ...overrides,
    };
  }

  it('posts Dr Cash / Cr AR and marks PAID when the payment covers the full balance', async () => {
    const { tenantDb, journalEntryCalls, invoiceUpdateCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue(invoiceStub());
    tenantDb.salesInvoice.findUniqueOrThrow.mockResolvedValue(invoiceStub({ status: 'PAID', paidAmount: 1_000_000 }));

    await service.recordPayment(makeCtx(tenantDb), 'inv-1', { amount: 1_000_000, method: 'CASH' });

    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string; debit: bigint; credit: bigint }> }).create;
    expect(sumLines(lines)).toEqual({ debit: 1_000_000n, credit: 1_000_000n });
    expect(lines).toEqual([
      { accountId: 'acc-cash', debit: 1_000_000n, credit: 0n },
      { accountId: 'acc-ar', debit: 0n, credit: 1_000_000n },
    ]);
    expect(invoiceUpdateCalls[0]).toMatchObject({ paidAmount: 1_000_000, status: 'PAID' });
  });

  it('marks PARTIALLY_PAID when the payment is less than the remaining balance', async () => {
    const { tenantDb, invoiceUpdateCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue(invoiceStub({ total: 1_000_000 }));
    tenantDb.salesInvoice.findUniqueOrThrow.mockResolvedValue(invoiceStub());

    await service.recordPayment(makeCtx(tenantDb), 'inv-1', { amount: 400_000, method: 'CASH' });

    expect(invoiceUpdateCalls[0]).toMatchObject({ paidAmount: 400_000, status: 'PARTIALLY_PAID' });
  });

  it('routes a BANK_TRANSFER payment through the bank account, not cash', async () => {
    const { tenantDb, journalEntryCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue(invoiceStub());
    tenantDb.salesInvoice.findUniqueOrThrow.mockResolvedValue(invoiceStub());

    await service.recordPayment(makeCtx(tenantDb), 'inv-1', { amount: 1_000_000, method: 'BANK_TRANSFER' });

    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string }> }).create;
    expect(lines[0].accountId).toBe('acc-bank');
  });

  it('rejects a payment larger than the remaining balance', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue(invoiceStub({ total: 1_000_000, paidAmount: 800_000 }));
    await expect(
      service.recordPayment(makeCtx(tenantDb), 'inv-1', { amount: 300_000, method: 'CASH' }),
    ).rejects.toThrow();
  });

  it('rejects a CHECK payment missing the Sayad ID or due date', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue(invoiceStub());
    await expect(
      service.recordPayment(makeCtx(tenantDb), 'inv-1', { amount: 1_000_000, method: 'CHECK' }),
    ).rejects.toThrow();
  });

  it('creates a linked RECEIVED Check row for a CHECK payment with full details', async () => {
    const { tenantDb, checkCalls } = makeTenantDb();
    tenantDb.salesInvoice.findUnique.mockResolvedValue(invoiceStub());
    tenantDb.salesInvoice.findUniqueOrThrow.mockResolvedValue(invoiceStub());

    await service.recordPayment(makeCtx(tenantDb), 'inv-1', {
      amount: 1_000_000,
      method: 'CHECK',
      checkSayadId: '1234567890123456',
      checkDueDate: '2026-12-01',
      checkBankName: 'بانک ملی',
    });

    expect(checkCalls).toHaveLength(1);
    expect(checkCalls[0]).toMatchObject({
      direction: 'RECEIVED',
      sayadId: '1234567890123456',
      amount: 1_000_000,
      contactId: 'contact-1',
      invoiceId: 'inv-1',
    });
  });
});
