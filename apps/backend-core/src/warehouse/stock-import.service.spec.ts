import { describe, expect, it, vi } from 'vitest';
import { StockImportService, hashFile } from './stock-import.service.js';
import { CostingService } from './costing.service.js';
import { buildExcelBuffer } from '../common/excel.js';
import { STOCK_IMPORT_HEADERS } from './stock-import.rules.js';
import type { TenantRequestContext } from '../common/request-context.js';

const HEADERS = [...STOCK_IMPORT_HEADERS];

async function xlsx(rows: Array<Record<string, string | number>>) {
  const buf = await buildExcelBuffer(HEADERS, rows, 'موجودی اولیه');
  return { buf, base64: buf.toString('base64'), hash: hashFile(buf) };
}

function setup(opts: { accounting?: boolean; liveBatch?: boolean; batchMovements?: any[]; history?: any[] } = {}) {
  const movementCreates: Array<Record<string, any>> = [];
  const productCreates: Array<Record<string, any>> = [];
  const journalCreates: Array<Record<string, any>> = [];
  const batchCreates: Array<Record<string, any>> = [];
  const batchUpdates: Array<Record<string, any>> = [];
  const db: any = {
    product: {
      findMany: vi.fn(async () => [{ id: 'p1', sku: 'P-1', name: 'میلگرد', unit: 'کیلو', costPrice: 100 }]),
      findUnique: vi.fn(async ({ where }: any) => (where.sku ? null : { name: 'میلگرد', costPrice: 100, profitMarginPercent: null, salePriceSource: 'AUTO' })),
      create: vi.fn(async ({ data }: any) => { productCreates.push(data); return { id: `np${productCreates.length}`, ...data }; }),
      update: vi.fn(async () => ({})),
    },
    warehouse: { findMany: vi.fn(async () => [{ id: 'w1', name: 'انبار مرکزی', isDefault: true }]), findFirst: vi.fn(async () => ({ id: 'w1', isDefault: true })) },
    stockMovement: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => opts.history ?? []),
      create: vi.fn(async ({ data }: any) => { movementCreates.push(data); return data; }),
      update: vi.fn(async () => ({})),
    },
    stockImportBatch: {
      findFirst: vi.fn(async () => (opts.liveBatch ? { id: 'old', fileName: 'a.xlsx', createdAt: new Date(), rowCount: 3 } : null)),
      create: vi.fn(async ({ data }: any) => { batchCreates.push(data); return { id: 'batch-123456', ...data }; }),
      update: vi.fn(async ({ data }: any) => { batchUpdates.push(data); return { id: 'batch-123456', createdProducts: data.createdProducts ?? 0, journalEntryId: data.journalEntryId ?? null }; }),
      findUnique: vi.fn(async () => ({ id: 'b1', voidedAt: null, journalEntryId: 'je1', movements: opts.batchMovements ?? [] })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    account: { count: vi.fn(async () => 5), findUnique: vi.fn(async ({ where }: any) => ({ id: `acc-${where.code}`, code: where.code, type: 'EQUITY' })) },
    journalEntry: {
      create: vi.fn(async ({ data }: any) => { journalCreates.push(data); return { id: `je-${journalCreates.length}` }; }),
      findUnique: vi.fn(async () => ({ id: 'je1', lines: [{ accountId: 'acc-1040', debit: 100n, credit: 0n, description: null }, { accountId: 'acc-3010', debit: 0n, credit: 100n, description: null }] })),
      update: vi.fn(async () => ({})),
    },
    moduleSetting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'مدیر' })) },
    documentRevision: { create: vi.fn(async () => ({})) },
    activityLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (cb: any) => cb(db)),
  };
  const controlDb: any = {
    moduleDefinition: { findMany: vi.fn(async () => [{ id: 'm1', code: 'accounting', dependsOn: [], isCore: false }]) },
    tenantModule: { findMany: vi.fn(async () => (opts.accounting ? [{ moduleId: 'm1', status: 'INSTALLED' }] : [])) },
  };
  const svc = new StockImportService(new CostingService(), controlDb);
  const ctx = { tenantDb: db, auth: { role: 'OWNER', sub: 'g' }, tenantId: 't' } as unknown as TenantRequestContext;
  return { svc, ctx, db, movementCreates, productCreates, journalCreates, batchCreates, batchUpdates };
}

const good = [{ 'کد کالا': 'P-1', 'نام کالا': 'میلگرد', انبار: 'انبار مرکزی', تعداد: 10, 'بهای واحد (تومان)': 200, واحد: 'کیلو', 'شماره لات/بچ': 'L1', 'محل قفسه': 'A1' }];

describe('StockImportService.preview (dry-run)', () => {
  it('returns rows, totals, a file hash and writes nothing', async () => {
    const t = setup();
    const f = await xlsx(good);
    const p = await t.svc.preview(t.ctx, f.base64, false);
    expect(p.fileHash).toBe(f.hash);
    expect(p).toMatchObject({ okCount: 1, errorCount: 0, totalQuantity: 10, totalValue: 2000, canCommit: true });
    expect(t.db.$transaction).not.toHaveBeenCalled();
    expect(t.movementCreates).toHaveLength(0);
  });
  it('cannot commit when rows have errors or the file was already imported', async () => {
    const bad = await xlsx([{ 'کد کالا': 'NOPE', 'نام کالا': '', انبار: '', تعداد: 1, 'بهای واحد (تومان)': 1, واحد: '', 'شماره لات/بچ': '', 'محل قفسه': '' }]);
    const p = await setup().svc.preview(setup().ctx, bad.base64, false);
    expect(p.canCommit).toBe(false);
    expect(p.rows[0].messages[0]).toMatch(/کالا یافت نشد/);
    const dup = await setup({ liveBatch: true }).svc.preview(setup({ liveBatch: true }).ctx, (await xlsx(good)).base64, false);
    expect(dup.duplicateOf?.id).toBe('old');
    expect(dup.canCommit).toBe(false);
  });
  it('rejects a file without the required columns', async () => {
    const buf = await buildExcelBuffer(['فلان'], [{ فلان: 'x' }]);
    const t = setup();
    await expect(t.svc.preview(t.ctx, buf.toString('base64'), false)).rejects.toThrow(/ستون/);
  });
});

describe('StockImportService.commit', () => {
  it('creates opening-receipt movements, a batch, and the opening journal when accounting is installed — in one transaction', async () => {
    const t = setup({ accounting: true });
    const f = await xlsx(good);
    const r = await t.svc.commit(t.ctx, { fileBase64: f.base64, fileName: 'x.xlsx', fileHash: f.hash, createMissing: false, confirm: true });
    expect(t.db.$transaction).toHaveBeenCalledTimes(1);
    expect(t.movementCreates).toEqual([
      expect.objectContaining({ productId: 'p1', warehouseId: 'w1', type: 'RECEIPT', quantityDelta: 10, unitCost: 200, origin: 'OPENING_IMPORT', importBatchId: 'batch-123456', note: 'لات: L1 — محل: A1' }),
    ]);
    expect(t.journalCreates).toHaveLength(1);
    const lines = t.journalCreates[0].lines.create;
    expect(lines.find((l: any) => l.accountId === 'acc-1040').debit).toBe(2000n);
    expect(lines.find((l: any) => l.accountId === 'acc-3020').credit).toBe(2000n);
    expect(r).toMatchObject({ rows: 1, totalValue: 2000, journalPosted: true });
    expect(t.batchCreates[0]).toMatchObject({ fileHash: f.hash, rowCount: 1, totalQuantity: 10 });
  });

  it('falls back to 3010 capital when the opening account 3020 is missing', async () => {
    const t = setup({ accounting: true });
    t.db.account.findUnique = vi.fn(async ({ where }: any) => (where.code === '3020' ? null : { id: `acc-${where.code}`, code: where.code }));
    t.db.account.create = vi.fn(async () => { throw new Error('boom'); }); // ensure fails -> still falls back
    const f = await xlsx(good);
    await t.svc.commit(t.ctx, { fileBase64: f.base64, fileName: 'x.xlsx', fileHash: f.hash, createMissing: false, confirm: true });
    const lines = t.journalCreates[0].lines.create;
    expect(lines.find((l: any) => l.accountId === 'acc-3010').credit).toBe(2000n);
  });

  it('posts no journal when the accounting module is not installed', async () => {
    const t = setup({ accounting: false });
    const f = await xlsx(good);
    const r = await t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: f.hash, createMissing: false, confirm: true });
    expect(t.journalCreates).toHaveLength(0);
    expect(r.journalPosted).toBe(false);
    expect(t.movementCreates).toHaveLength(1);
  });

  it('creates missing products only when asked, once per product across warehouses', async () => {
    const t = setup();
    const rows = [{ 'کد کالا': 'N-1', 'نام کالا': 'جدید', انبار: 'انبار مرکزی', تعداد: 3, 'بهای واحد (تومان)': 50, واحد: 'متر', 'شماره لات/بچ': '', 'محل قفسه': '' }];
    const f = await xlsx(rows);
    await expect(t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: f.hash, createMissing: false, confirm: true })).rejects.toThrow(/خطا دارد/);
    expect(t.productCreates).toHaveLength(0);
    const r = await t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: f.hash, createMissing: true, confirm: true });
    expect(t.productCreates).toEqual([expect.objectContaining({ sku: 'N-1', name: 'جدید', unit: 'متر', costPrice: 50 })]);
    expect(r.createdProducts).toBe(1);
    expect(t.movementCreates[0].productId).toBe('np1');
  });

  it('is idempotent: the same file cannot be imported twice', async () => {
    const t = setup({ liveBatch: true });
    const f = await xlsx(good);
    await expect(t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: f.hash, createMissing: false, confirm: true })).rejects.toThrow(/قبلاً وارد شده/);
    expect(t.movementCreates).toHaveLength(0);
  });

  it('requires explicit confirmation and a hash matching the previewed file', async () => {
    const t = setup();
    const f = await xlsx(good);
    await expect(t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: f.hash, createMissing: false, confirm: false })).rejects.toThrow(/تأیید صریح/);
    await expect(t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: 'a'.repeat(64), createMissing: false, confirm: true })).rejects.toThrow(/یکی نیست/);
    expect(t.db.$transaction).not.toHaveBeenCalled();
  });

  it('is all-or-nothing: any invalid row blocks the whole import', async () => {
    const t = setup();
    const f = await xlsx([...good, { 'کد کالا': 'P-1', 'نام کالا': '', انبار: 'انبار مرکزی', تعداد: -1, 'بهای واحد (تومان)': 1, واحد: '', 'شماره لات/بچ': 'L9', 'محل قفسه': '' }]);
    await expect(t.svc.commit(t.ctx, { fileBase64: f.base64, fileHash: f.hash, createMissing: false, confirm: true })).rejects.toThrow(/ثبت جزئی انجام نمی‌شود/);
    expect(t.movementCreates).toHaveLength(0);
  });
});

describe('StockImportService.voidBatch', () => {
  const mv = (id: string, qty: number) => ({ id, productId: 'p1', warehouseId: 'w1', quantityDelta: qty, voidedAt: null });
  it('voids movements with counter rows and reverses the opening journal', async () => {
    const t = setup({
      batchMovements: [mv('m1', 10)],
      history: [{ id: 'm1', createdAt: new Date(2026, 0, 1), quantityDelta: 10, voidedAt: null, reversalOfId: null }],
    });
    await t.svc.voidBatch(t.ctx, 'b1', 'فایل اشتباه بود');
    expect(t.movementCreates[0]).toMatchObject({ quantityDelta: -10, reversalOfId: 'm1', origin: 'OPENING_IMPORT' });
    expect(t.journalCreates[0]).toMatchObject({ reversalOfId: 'je1' });
    expect(t.journalCreates[0].lines.create[0]).toMatchObject({ debit: 0n, credit: 100n });
  });
  it('is blocked when later issues consumed the imported stock', async () => {
    const t = setup({
      batchMovements: [mv('m1', 10)],
      history: [
        { id: 'm1', createdAt: new Date(2026, 0, 1), quantityDelta: 10, voidedAt: null, reversalOfId: null },
        { id: 'i1', createdAt: new Date(2026, 0, 2), quantityDelta: -4, voidedAt: null, reversalOfId: null },
      ],
    });
    await expect(t.svc.voidBatch(t.ctx, 'b1', 'دلیل')).rejects.toThrow(/منفی/);
    expect(t.db.$transaction).not.toHaveBeenCalled();
  });
});
