import { describe, expect, it } from 'vitest';
import { DispatchRuleError } from './dispatch-state.js';
import {
  computeNetKg,
  distributeUnits,
  invoiceFinalizationBlock,
  proposeInvoiceAdjustment,
  roundKg,
  validateNetEdit,
  type AdjustmentInput,
} from './dispatch-weight.js';

describe('net weight', () => {
  it('net = gross - tare, rounded to grams', () => {
    expect(computeNetKg(14200, 38650.5)).toBe(24450.5);
    expect(computeNetKg(0.1, 0.3)).toBe(0.2);
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
  });
  it('rejects gross <= tare and invalid numbers', () => {
    expect(() => computeNetKg(20000, 20000)).toThrow(DispatchRuleError);
    expect(() => computeNetKg(20000, 100)).toThrow(/بیشتر/);
    expect(() => computeNetKg(-1, 100)).toThrow();
    expect(() => computeNetKg(NaN, 100)).toThrow();
  });
  it('manual net edit needs a reason', () => {
    expect(() => validateNetEdit(1000, '')).toThrow(/دلیل/);
    expect(validateNetEdit(1000.0004, 'اصلاح خطای باسکول')).toEqual({ netKg: 1000, reason: 'اصلاح خطای باسکول' });
    expect(() => validateNetEdit(0, 'x yz')).toThrow();
  });
});

const invoice = (over: Partial<AdjustmentInput> = {}): AdjustmentInput => ({
  lines: [{ id: 'l1', description: 'ذرت', quantity: 20000, unitPrice: 100 }],
  subtotal: 2_000_000,
  discount: 0,
  taxAmount: 0,
  total: 2_000_000,
  taxRate: null,
  netWeightKg: 24450,
  weighLineIds: [],
  kgPerUnit: 1,
  ...over,
});

describe('invoice weight adjustment', () => {
  it('single line: quantity becomes the actual weight and totals follow', () => {
    const r = proposeInvoiceAdjustment(invoice());
    expect(r.lineChanges[0]).toMatchObject({ oldQty: 20000, newQty: 24450, newTotal: 2_445_000 });
    expect(r.newSubtotal).toBe(2_445_000);
    expect(r.newTotal).toBe(2_445_000);
    expect(r.changed).toBe(true);
  });
  it('no change when weight equals invoice quantity', () => {
    expect(proposeInvoiceAdjustment(invoice({ netWeightKg: 20000 })).changed).toBe(false);
  });
  it('discount scales proportionally; tax recomputed for official invoices', () => {
    const r = proposeInvoiceAdjustment(
      invoice({ discount: 200_000, taxRate: 10, taxAmount: 180_000, total: 1_980_000, netWeightKg: 10000 }),
    );
    expect(r.newSubtotal).toBe(1_000_000);
    expect(r.newDiscount).toBe(100_000);
    expect(r.newTaxAmount).toBe(90_000);
    expect(r.newTotal).toBe(990_000);
    expect(r.oldTotal).toBe(1_980_000);
  });
  it('multiple weight lines share the actual weight proportionally and sum exactly', () => {
    const r = proposeInvoiceAdjustment(
      invoice({
        lines: [
          { id: 'a', description: 'الف', quantity: 5000, unitPrice: 10 },
          { id: 'b', description: 'ب', quantity: 5000, unitPrice: 20 },
          { id: 'c', description: 'خدمات', quantity: 1, unitPrice: 1000 },
        ],
        subtotal: 151_000,
        total: 151_000,
        netWeightKg: 10001,
        weighLineIds: ['a', 'b'],
      }),
    );
    const a = r.lineChanges.find((l) => l.lineId === 'a')!;
    const b = r.lineChanges.find((l) => l.lineId === 'b')!;
    const c = r.lineChanges.find((l) => l.lineId === 'c')!;
    expect(a.newQty + b.newQty).toBe(10001);
    expect(c.newQty).toBe(1); // ردیف غیروزنی دست‌نخورده
  });
  it('kgPerUnit converts kg to invoice units (e.g. 50 kg bags)', () => {
    const r = proposeInvoiceAdjustment(invoice({ lines: [{ id: 'l1', description: 'کیسه', quantity: 400, unitPrice: 5000 }], subtotal: 2_000_000, total: 2_000_000, netWeightKg: 20100, kgPerUnit: 50 }));
    expect(r.lineChanges[0].newQty).toBe(402);
  });
  it('rejects empty selection and too-small weights', () => {
    expect(() => proposeInvoiceAdjustment(invoice({ weighLineIds: ['zzz'] }))).toThrow(/ردیف/);
    expect(() => proposeInvoiceAdjustment(invoice({ netWeightKg: 20, kgPerUnit: 50 }))).toThrow(/کمتر از یک واحد/);
  });
  it('distributeUnits keeps the exact total', () => {
    for (const [qtys, t] of [[[1, 1, 1], 10], [[3, 5, 7], 101], [[0, 0], 9], [[5], 3]] as Array<[number[], number]>) {
      expect(distributeUnits(qtys, t).reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
});

describe('invoice finalization gate', () => {
  const f = { needsWeighing: true, shipmentCancelled: false, weightConfirmed: false, adjustmentStatus: null as string | null };
  it('invoices that do not need weighing behave exactly as before', () => {
    expect(invoiceFinalizationBlock({ ...f, needsWeighing: false })).toBeNull();
  });
  it('blocks until weight is confirmed and the adjustment is applied', () => {
    expect(invoiceFinalizationBlock(f)).toMatch(/تأیید وزن/);
    expect(invoiceFinalizationBlock({ ...f, weightConfirmed: true })).toMatch(/هنوز/);
    expect(invoiceFinalizationBlock({ ...f, weightConfirmed: true, adjustmentStatus: 'PROPOSED' })).toMatch(/انتظار/);
    expect(invoiceFinalizationBlock({ ...f, weightConfirmed: true, adjustmentStatus: 'REJECTED' })).toBeTruthy();
    expect(invoiceFinalizationBlock({ ...f, weightConfirmed: true, adjustmentStatus: 'APPLIED' })).toBeNull();
    expect(invoiceFinalizationBlock({ ...f, weightConfirmed: true, adjustmentStatus: 'NO_CHANGE' })).toBeNull();
  });
  it('a cancelled shipment releases the invoice', () => {
    expect(invoiceFinalizationBlock({ ...f, shipmentCancelled: true })).toBeNull();
  });
});
