import { describe, expect, it, vi } from 'vitest';
import { MovementAmendmentService } from './movement-amendment.service.js';
import { CostingService } from './costing.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

type Row = { id: string; productId: string; warehouseId: string; type: string; quantityDelta: number; unitCost: number | null; reference: string | null; note: string | null; origin: string | null; transferGroupId: string | null; voidedAt: Date | null; reversalOfId: string | null; importBatchId: string | null; editCount: number; createdAt: Date };

const row = (over: Partial<Row>): Row => ({
  id: 'm1', productId: 'p1', warehouseId: 'w1', type: 'RECEIPT', quantityDelta: 10, unitCost: 100, reference: 'رسید دستی', note: null, origin: 'MANUAL',
  transferGroupId: null, voidedAt: null, reversalOfId: null, importBatchId: null, editCount: 0, createdAt: new Date(2026, 0, 1), ...over,
});

function setup(rows: Row[], opts: { shipments?: number; guard?: number; method?: string } = {}) {
  const creates: Array<Record<string, any>> = [];
  const updates: Array<Record<string, any>> = [];
  const revisions: Array<Record<string, any>> = [];
  const productUpdates: Array<Record<string, any>> = [];
  const db: any = {
    stockMovement: {
      findUnique: vi.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r, product: { id: 'p1', name: 'میلگرد', unit: 'کیلو' }, warehouse: { id: 'w1', name: 'مرکزی' } } : null;
      }),
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => r.productId === where.productId && (!where.warehouseId || r.warehouseId === where.warehouseId) && (where.voidedAt === undefined || r.voidedAt === null) && (where.reversalOfId === undefined || r.reversalOfId === null || false)).map((r) => ({ ...r }))),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => rows.find((x) => x.id === where.id)),
      updateMany: vi.fn(async (a: any) => {
        updates.push(a);
        const count = opts.guard ?? 1;
        const target = rows.find((r) => r.id === a.where.id);
        if (count && target) {
          const { editCount: _ec, ...rest } = a.data;
          Object.assign(target, rest);
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => { creates.push(data); return data; }),
    },
    shipment: { count: vi.fn(async () => opts.shipments ?? 0) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'انباردار' })) },
    moduleSetting: { findUnique: vi.fn(async () => (opts.method ? { value: opts.method } : null)) },
    product: {
      findUnique: vi.fn(async () => ({ costPrice: 100, profitMarginPercent: null, salePriceSource: 'AUTO' })),
      update: vi.fn(async (a: any) => { productUpdates.push(a); return {}; }),
    },
    documentRevision: { create: vi.fn(async ({ data }: any) => { revisions.push(data); return data; }) },
    activityLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (cb: any) => cb(db)),
  };
  const ctx = { tenantDb: db, auth: { role: 'OWNER', sub: 'g' }, tenantId: 't' } as unknown as TenantRequestContext;
  return { svc: new MovementAmendmentService(new CostingService()), ctx, db, creates, updates, revisions, productUpdates };
}

describe('MovementAmendmentService.edit', () => {
  it('edits quantity and cost in place, records revision with diff, recomputes cost price', async () => {
    const t = setup([row({})]);
    await t.svc.edit(t.ctx, 'm1', { quantity: 20, unitCost: 150, reason: 'اشتباه تایپی' });
    expect(t.updates[0].data).toMatchObject({ quantityDelta: 20, unitCost: 150 });
    expect(t.updates[0].where).toMatchObject({ id: 'm1', voidedAt: null, editCount: 0 });
    expect(t.revisions[0]).toMatchObject({ entityType: 'stock_movement', action: 'EDIT', reason: 'اشتباه تایپی', revisionNo: 1, userName: 'انباردار' });
    expect(t.revisions[0].changes.map((c: any) => c.field)).toEqual(expect.arrayContaining(['مقدار', 'بهای واحد']));
    // LAST_COST (default): cost price follows the edited receipt (100 -> 150)
    expect(t.productUpdates[0]).toMatchObject({ where: { id: 'p1' }, data: { costPrice: 150 } });
  });

  it('refuses a quantity cut that would make a later issue exceed the stock', async () => {
    const t = setup([row({}), row({ id: 'i1', type: 'ISSUE', quantityDelta: -8, unitCost: null, createdAt: new Date(2026, 0, 2) })]);
    await expect(t.svc.edit(t.ctx, 'm1', { quantity: 5, reason: 'کاهش' })).rejects.toThrow(/منفی/);
    expect(t.db.$transaction).not.toHaveBeenCalled();
  });

  it('allows a quantity cut that stays covered', async () => {
    const t = setup([row({}), row({ id: 'i1', type: 'ISSUE', quantityDelta: -8, unitCost: null, createdAt: new Date(2026, 0, 2) })]);
    await expect(t.svc.edit(t.ctx, 'm1', { quantity: 9, reason: 'کاهش' })).resolves.toBeDefined();
  });

  it('refuses system-owned and import rows, and rows with an active shipment', async () => {
    const sys = setup([row({ type: 'ISSUE', origin: null, reference: 'فاکتور فروش #3', quantityDelta: -1 })]);
    await expect(sys.svc.edit(sys.ctx, 'm1', { quantity: 2, reason: 'دلیل' })).rejects.toThrow(/فاکتور فروش/);
    const imp = setup([row({ origin: 'OPENING_IMPORT', importBatchId: 'b1' })]);
    await expect(imp.svc.edit(imp.ctx, 'm1', { quantity: 2, reason: 'دلیل' })).rejects.toThrow(/موجودی اولیه/);
    const ship = setup([row({ type: 'ISSUE', quantityDelta: -1, unitCost: null })], { shipments: 1 });
    await expect(ship.svc.edit(ship.ctx, 'm1', { quantity: 2, reason: 'دلیل' })).rejects.toThrow(/بار/);
    expect(sys.db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses cost on non-receipts, empty changes and non-positive quantity', async () => {
    const t = setup([row({ type: 'ISSUE', quantityDelta: -3, unitCost: null })]);
    await expect(t.svc.edit(t.ctx, 'm1', { unitCost: 5, reason: 'دلیل' })).rejects.toThrow(/بهای واحد/);
    await expect(t.svc.edit(t.ctx, 'm1', { quantity: 3, reason: 'دلیل' })).rejects.toThrow(/هیچ تغییری/);
    await expect(t.svc.edit(t.ctx, 'm1', { quantity: 0, reason: 'دلیل' })).rejects.toThrow(/صفر/);
  });

  it('turns a concurrent edit into a conflict', async () => {
    const t = setup([row({})], { guard: 0 });
    await expect(t.svc.edit(t.ctx, 'm1', { quantity: 11, reason: 'دلیل' })).rejects.toThrow(/هم‌زمان/);
    expect(t.revisions).toHaveLength(0);
  });
});

describe('MovementAmendmentService.void', () => {
  it('soft-voids: marks the original, appends a counter movement linked by reversalOfId, writes a VOID revision', async () => {
    const t = setup([row({})]);
    await t.svc.void(t.ctx, 'm1', 'رسید اشتباه');
    expect(t.updates[0].data).toMatchObject({ voidReason: 'رسید اشتباه' });
    expect(t.updates[0].data.voidedAt).toBeInstanceOf(Date);
    expect(t.creates[0]).toMatchObject({ productId: 'p1', warehouseId: 'w1', quantityDelta: -10, reversalOfId: 'm1', type: 'ADJUSTMENT' });
    expect(t.revisions[0]).toMatchObject({ action: 'VOID', reason: 'رسید اشتباه' });
  });

  it('never hard-deletes (no delete API is even mocked) and restores an issue to stock', async () => {
    const t = setup([row({ id: 'r', quantityDelta: 10 }), row({ id: 'i', type: 'ISSUE', quantityDelta: -4, unitCost: null, createdAt: new Date(2026, 0, 2) })]);
    await t.svc.void(t.ctx, 'i', 'اشتباه');
    expect(t.creates[0]).toMatchObject({ quantityDelta: 4, reversalOfId: 'i' });
  });

  it('refuses to void a receipt that later issues consumed', async () => {
    const t = setup([row({}), row({ id: 'i1', type: 'ISSUE', quantityDelta: -3, unitCost: null, createdAt: new Date(2026, 0, 2) })]);
    await expect(t.svc.void(t.ctx, 'm1', 'دلیل')).rejects.toThrow(/منفی/);
    expect(t.db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to void twice / a linked document', async () => {
    const twice = setup([row({ voidedAt: new Date() })]);
    await expect(twice.svc.void(twice.ctx, 'm1', 'دلیل')).rejects.toThrow(/قبلاً باطل/);
    const linked = setup([row({ type: 'PURCHASE_RETURN', quantityDelta: -1, origin: null })]);
    await expect(linked.svc.void(linked.ctx, 'm1', 'دلیل')).rejects.toThrow(/فقط از همان سند/);
  });

  it('unknown id is a 404', async () => {
    const t = setup([]);
    await expect(t.svc.void(t.ctx, 'zzz', 'دلیل')).rejects.toThrow(/یافت نشد/);
  });
});
