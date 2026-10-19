import { describe, expect, it } from 'vitest';
import { parseCellNumber, planOpeningStockImport, STOCK_IMPORT_MAX_ROWS } from './stock-import.rules.js';

const products = [
  { id: 'p1', sku: 'P-1', name: 'میلگرد', unit: 'کیلو', costPrice: 1000 },
  { id: 'p2', sku: 'P-2', name: 'سیمان', unit: 'کیسه', costPrice: 0 },
  { id: 'p3', sku: 'P-3', name: 'تکراری', unit: 'عدد', costPrice: 5 },
  { id: 'p4', sku: 'P-4', name: 'تکراری', unit: 'عدد', costPrice: 5 },
];
const warehouses = [{ id: 'w1', name: 'انبار مرکزی', isDefault: true }, { id: 'w2', name: 'انبار شعبه', isDefault: false }];
const run = (rows: Array<Record<string, string | number | null>>, createMissing = false, existing?: Set<string>) =>
  planOpeningStockImport(rows, { products, warehouses, createMissing, existingStockKeys: existing });

describe('parseCellNumber', () => {
  it('handles Persian digits, separators and bad input', () => {
    expect(parseCellNumber('۱٬۲۰۰')).toBe(1200);
    expect(parseCellNumber('1,500')).toBe(1500);
    expect(parseCellNumber('٣')).toBe(3);
    expect(parseCellNumber('')).toBeNull();
    expect(parseCellNumber(null)).toBeNull();
    expect(parseCellNumber('abc')).toBeNaN();
    expect(parseCellNumber(7)).toBe(7);
  });
});

describe('planOpeningStockImport', () => {
  it('accepts a valid row and defaults the warehouse', () => {
    const p = run([{ 'کد کالا': 'p-1', تعداد: 10, 'بهای واحد (تومان)': 1200 }]);
    expect(p.rows[0]).toMatchObject({ status: 'OK', productId: 'p1', warehouseId: 'w1', quantity: 10, unitCost: 1200 });
    expect(p.totalValue).toBe(12000);
    expect(p.okCount).toBe(1);
  });
  it('reports Persian errors for unknown product, warehouse, negative/zero/fractional/blank quantity, bad cost', () => {
    const p = run([
      { 'کد کالا': 'NOPE', تعداد: 1 },
      { 'کد کالا': 'P-1', انبار: 'ناموجود', تعداد: 1 },
      { 'کد کالا': 'P-1', تعداد: -3 },
      { 'کد کالا': 'P-2', تعداد: 0 },
      { 'کد کالا': 'P-1', انبار: 'انبار شعبه', تعداد: 1.5 },
      { 'کد کالا': 'P-2', انبار: 'انبار شعبه' },
      { 'کد کالا': 'P-1', انبار: 'انبار شعبه', تعداد: 2, 'بهای واحد (تومان)': -5 },
    ]);
    const msgs = p.rows.map((r) => r.messages.join('|'));
    expect(msgs[0]).toMatch(/کالا یافت نشد/);
    expect(msgs[1]).toMatch(/انبار «ناموجود» یافت نشد/);
    expect(msgs[2]).toMatch(/منفی/);
    expect(msgs[3]).toMatch(/صفر/);
    expect(msgs[4]).toMatch(/صحیح/);
    expect(msgs[5]).toMatch(/تعداد خالی/);
    expect(msgs[6]).toMatch(/بهای واحد منفی/);
    expect(p.errorCount).toBe(7);
  });
  it('flags unit mismatch against the existing product', () => {
    const p = run([{ 'کد کالا': 'P-1', تعداد: 1, واحد: 'عدد' }]);
    expect(p.rows[0].messages[0]).toMatch(/مطابقت ندارد/);
  });
  it('flags duplicates (same product + warehouse + lot) but allows other warehouses or lots', () => {
    const p = run([
      { 'کد کالا': 'P-1', تعداد: 1 },
      { 'کد کالا': 'P-1', تعداد: 2 },
      { 'کد کالا': 'P-1', انبار: 'انبار شعبه', تعداد: 2 },
      { 'کد کالا': 'P-1', تعداد: 2, 'شماره لات/بچ': 'L2' },
    ]);
    expect(p.rows.map((r) => r.status)).toEqual(['OK', 'ERROR', 'OK', 'OK']);
    expect(p.rows[1].messages[0]).toMatch(/ردیف 2/);
  });
  it('ambiguous product name asks for a code', () => {
    const p = run([{ 'نام کالا': 'تکراری', تعداد: 1 }]);
    expect(p.rows[0].messages[0]).toMatch(/چند کالا/);
  });
  it('createMissing marks unknown products for creation (name required) and counts them once', () => {
    const p = run(
      [
        { 'کد کالا': 'N-1', 'نام کالا': 'جدید', تعداد: 3, 'بهای واحد (تومان)': 10 },
        { 'کد کالا': 'N-1', 'نام کالا': 'جدید', انبار: 'انبار شعبه', تعداد: 4, 'بهای واحد (تومان)': 10 },
        { 'کد کالا': 'N-2', تعداد: 1 },
      ],
      true,
    );
    expect(p.rows[0]).toMatchObject({ status: 'OK', createsProduct: true });
    expect(p.rows[1]).toMatchObject({ status: 'OK', createsProduct: true });
    expect(p.rows[2].messages[0]).toMatch(/نام کالا الزامی/);
    expect(p.newProducts).toBe(1);
  });
  it('warns (not errors) when cost is missing or stock already exists', () => {
    const p = run([{ 'کد کالا': 'P-2', تعداد: 1 }, { 'کد کالا': 'P-1', تعداد: 1 }], false, new Set(['p1|w1']));
    expect(p.rows[0].status).toBe('OK');
    expect(p.rows[0].warnings[0]).toMatch(/بهای واحد ندارد/);
    expect(p.rows[1].unitCost).toBe(1000);
    expect(p.rows[1].warnings.join('')).toMatch(/از قبل/);
  });
  it('caps the number of rows', () => {
    const rows = Array.from({ length: STOCK_IMPORT_MAX_ROWS + 3 }, (_, i) => ({ 'کد کالا': 'P-1', انبار: 'انبار شعبه', تعداد: 1, 'شماره لات/بچ': `L${i}` }));
    const p = run(rows);
    expect(p.tooManyRows).toBe(true);
    expect(p.rows).toHaveLength(STOCK_IMPORT_MAX_ROWS);
  });
});
