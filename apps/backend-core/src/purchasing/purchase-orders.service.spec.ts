import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { CostingService } from '../warehouse/costing.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const ACCOUNTS_BY_CODE: Record<string, { id: string; code: string }> = {
  '1010': { id: 'acc-cash', code: '1010' },
  '1020': { id: 'acc-bank', code: '1020' },
  '1040': { id: 'acc-inventory', code: '1040' },
  '2010': { id: 'acc-payable', code: '2010' },
};

const automationStub = { emit: vi.fn() };
const approvalsStub = { request: vi.fn(), closeForEntity: vi.fn(), registerHandler: vi.fn() };
function makeTenantDb(overrides: Record<string, unknown> = {}) {
  const journalEntryCalls: Array<Record<string, unknown>> = [];
  const purchasePaymentCalls: Array<Record<string, unknown>> = [];
  const checkCalls: Array<Record<string, unknown>> = [];
  const stockMovementCalls: Array<Record<string, unknown>> = [];
  const productUpdateCalls: Array<Record<string, unknown>> = [];
  const orderUpdateCalls: Array<Record<string, unknown>> = [];

  const tenantDb = {
    account: {
      count: vi.fn().mockResolvedValue(11),
      findUnique: vi.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(ACCOUNTS_BY_CODE[where.code] ?? null),
      ),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', name: 'تستر' }) },
    moduleSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    crmContact: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'sup-1' }) },
    purchaseOrder: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'po-1', ...args.data })),
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        orderUpdateCalls.push(args.data);
        return Promise.resolve({ id: 'po-1', orderNo: 1, total: 0, supplier: { name: 'تأمین‌کننده تست', phone: null }, ...args.data });
      }),
    },
    product: {
      // بدون profitMarginPercent → nextSalePriceOnReceipt همیشه null برمی‌گرداند،
      // پس این mock رفتار موجود تست‌ها (فقط costPrice تغییر می‌کند) را حفظ می‌کند.
      findUnique: vi.fn().mockResolvedValue({ id: 'p1', profitMarginPercent: null, salePriceSource: 'AUTO' }),
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        productUpdateCalls.push(args.data);
        return Promise.resolve({ id: 'p1', ...args.data });
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
    purchasePayment: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        purchasePaymentCalls.push(args.data);
        return Promise.resolve({ id: 'pp-1', ...args.data });
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

  return {
    tenantDb,
    journalEntryCalls,
    purchasePaymentCalls,
    checkCalls,
    stockMovementCalls,
    productUpdateCalls,
    orderUpdateCalls,
  };
}

function makeCtx(tenantDb: unknown, role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER'): TenantRequestContext {
  return { tenantDb, auth: { type: 'user', sub: 'global-1', role }, tenantId: 't1' } as unknown as TenantRequestContext;
}

function sumLines(lines: Array<{ debit: bigint; credit: bigint }>) {
  return {
    debit: lines.reduce((s, l) => s + l.debit, 0n),
    credit: lines.reduce((s, l) => s + l.credit, 0n),
  };
}

describe('PurchaseOrdersService.receive — double-entry posting', () => {
  let service: PurchaseOrdersService;
  beforeEach(() => {
    service = new PurchaseOrdersService(new CostingService(), automationStub as never, approvalsStub as never);
  });

  function orderStub(overrides: Record<string, unknown> = {}) {
    return {
      id: 'po-1',
      orderNo: 1,
      status: 'DRAFT',
      approvalStatus: 'NOT_REQUIRED',
      supplierId: 'sup-1',
      total: 200_000_000,
      lines: [{ productId: 'p1', unitCost: 40_000_000, quantity: 5 }],
      ...overrides,
    };
  }

  it('posts a balanced Dr Inventory / Cr Payable entry and last-costs the product', async () => {
    const { tenantDb, journalEntryCalls, stockMovementCalls, productUpdateCalls } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub());

    await service.receive(makeCtx(tenantDb), 'po-1');

    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string; debit: bigint; credit: bigint }> }).create;
    expect(sumLines(lines)).toEqual({ debit: 200_000_000n, credit: 200_000_000n });
    expect(lines).toEqual([
      { accountId: 'acc-inventory', debit: 200_000_000n, credit: 0n },
      { accountId: 'acc-payable', debit: 0n, credit: 200_000_000n },
    ]);
    expect(stockMovementCalls[0]).toMatchObject({ productId: 'p1', type: 'RECEIPT', quantityDelta: 5, unitCost: 40_000_000 });
    expect(productUpdateCalls[0]).toMatchObject({ costPrice: 40_000_000 });
  });

  it('blocks receiving an order still pending approval', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub({ approvalStatus: 'PENDING' }));
    await expect(service.receive(makeCtx(tenantDb), 'po-1')).rejects.toThrow();
  });

  it('blocks receiving a rejected order', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub({ approvalStatus: 'REJECTED' }));
    await expect(service.receive(makeCtx(tenantDb), 'po-1')).rejects.toThrow();
  });

  it('allows receiving an approved order', async () => {
    const { tenantDb, orderUpdateCalls } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub({ approvalStatus: 'APPROVED' }));
    await service.receive(makeCtx(tenantDb), 'po-1');
    expect(orderUpdateCalls[0]).toMatchObject({ status: 'RECEIVED' });
  });

  it('refuses to receive a non-DRAFT order', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub({ status: 'RECEIVED' }));
    await expect(service.receive(makeCtx(tenantDb), 'po-1')).rejects.toThrow();
  });
});

describe('PurchaseOrdersService.recordPayment', () => {
  let service: PurchaseOrdersService;
  beforeEach(() => {
    service = new PurchaseOrdersService(new CostingService(), automationStub as never, approvalsStub as never);
  });

  function orderStub(overrides: Record<string, unknown> = {}) {
    return {
      id: 'po-1',
      orderNo: 7,
      status: 'RECEIVED',
      total: 100_000_000,
      paidAmount: 0,
      supplierId: 'sup-1',
      issuedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      ...overrides,
    };
  }

  it('posts Dr Payable / Cr Cash and marks PAID on full settlement', async () => {
    const { tenantDb, journalEntryCalls, orderUpdateCalls } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub());
    tenantDb.purchaseOrder.findUniqueOrThrow.mockResolvedValue(orderStub({ status: 'PAID', paidAmount: 100_000_000 }));

    await service.recordPayment(makeCtx(tenantDb), 'po-1', { amount: 100_000_000, method: 'CASH' });

    const lines = (journalEntryCalls[0].lines as { create: Array<{ accountId: string; debit: bigint; credit: bigint }> }).create;
    expect(sumLines(lines)).toEqual({ debit: 100_000_000n, credit: 100_000_000n });
    expect(lines).toEqual([
      { accountId: 'acc-payable', debit: 100_000_000n, credit: 0n },
      { accountId: 'acc-cash', debit: 0n, credit: 100_000_000n },
    ]);
    expect(orderUpdateCalls[0]).toMatchObject({ status: 'PAID' });
  });

  it('creates a linked ISSUED Check for a CHECK payment', async () => {
    const { tenantDb, checkCalls } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub());
    tenantDb.purchaseOrder.findUniqueOrThrow.mockResolvedValue(orderStub());

    await service.recordPayment(makeCtx(tenantDb), 'po-1', {
      amount: 100_000_000,
      method: 'CHECK',
      checkSayadId: '1111222233334444',
      checkDueDate: '2026-12-01',
    });

    expect(checkCalls[0]).toMatchObject({ direction: 'ISSUED', contactId: 'sup-1', purchaseOrderId: 'po-1' });
  });

  it('rejects payment on an order that has not been received yet', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue(orderStub({ status: 'DRAFT' }));
    await expect(
      service.recordPayment(makeCtx(tenantDb), 'po-1', { amount: 1000, method: 'CASH' }),
    ).rejects.toThrow();
  });
});

describe('PurchaseOrdersService approval authority', () => {
  let service: PurchaseOrdersService;
  beforeEach(() => {
    service = new PurchaseOrdersService(new CostingService(), automationStub as never, approvalsStub as never);
  });

  it('lets an OWNER approve a pending order', async () => {
    const { tenantDb, orderUpdateCalls } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', approvalStatus: 'PENDING' });
    await service.approve(makeCtx(tenantDb, 'OWNER'), 'po-1');
    expect(orderUpdateCalls[0]).toMatchObject({ approvalStatus: 'APPROVED' });
  });

  it('refuses a non-owner/admin trying to approve', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', approvalStatus: 'PENDING' });
    await expect(service.approve(makeCtx(tenantDb, 'MEMBER'), 'po-1')).rejects.toThrow();
  });

  it('refuses to approve an order that is not pending', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', approvalStatus: 'APPROVED' });
    await expect(service.approve(makeCtx(tenantDb, 'OWNER'), 'po-1')).rejects.toThrow();
  });

  it('records a rejection reason', async () => {
    const { tenantDb, orderUpdateCalls } = makeTenantDb();
    tenantDb.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', approvalStatus: 'PENDING' });
    await service.reject(makeCtx(tenantDb, 'ADMIN'), 'po-1', 'بودجه کافی نیست');
    expect(orderUpdateCalls[0]).toMatchObject({ approvalStatus: 'REJECTED', rejectionReason: 'بودجه کافی نیست' });
  });
});

describe('PurchaseOrdersService.create — approval threshold gating', () => {
  let service: PurchaseOrdersService;
  beforeEach(() => {
    service = new PurchaseOrdersService(new CostingService(), automationStub as never, approvalsStub as never);
  });

  it('marks NOT_REQUIRED when no threshold is configured', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.crmContact = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    tenantDb.purchaseOrder.create = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'po-1', ...args.data }),
    );

    const result = await service.create(makeCtx(tenantDb), {
      supplierId: 'sup-1',
      lines: [{ description: 'کالا', quantity: 1, unitCost: 999_999_999 }],
    } as never);

    expect(result.approvalStatus).toBe('NOT_REQUIRED');
  });

  it('marks PENDING when the order total meets or exceeds the configured threshold', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.crmContact = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    tenantDb.moduleSetting.findUnique = vi.fn().mockResolvedValue({ value: 100_000_000 });
    tenantDb.purchaseOrder.create = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'po-1', ...args.data }),
    );

    const result = await service.create(makeCtx(tenantDb), {
      supplierId: 'sup-1',
      lines: [{ description: 'کالا', quantity: 1, unitCost: 150_000_000 }],
    } as never);

    expect(result.approvalStatus).toBe('PENDING');
    expect(approvalsStub.request).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: 'PURCHASE_ORDER', entityId: 'po-1' }));
  });

  it('stays NOT_REQUIRED for an order below the threshold', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.crmContact = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    tenantDb.moduleSetting.findUnique = vi.fn().mockResolvedValue({ value: 100_000_000 });
    tenantDb.purchaseOrder.create = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'po-1', ...args.data }),
    );

    const result = await service.create(makeCtx(tenantDb), {
      supplierId: 'sup-1',
      lines: [{ description: 'کالا', quantity: 1, unitCost: 50_000_000 }],
    } as never);

    expect(result.approvalStatus).toBe('NOT_REQUIRED');
  });
});
