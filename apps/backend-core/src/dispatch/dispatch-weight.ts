import { DispatchRuleError, assertReason } from './dispatch-state.js';

/** گرد کردن به ۳ رقم اعشار (گرم) — برای جلوگیری از خطای ممیز شناور در وزن‌ها. */
export function roundKg(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function assertWeightValue(kg: unknown, label: string): number {
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) throw new DispatchRuleError(`${label} باید عددی بزرگ‌تر از صفر (کیلوگرم) باشد`);
  if (kg > 1_000_000) throw new DispatchRuleError(`${label} غیرمعمول است (بیش از ۱٬۰۰۰٬۰۰۰ کیلوگرم)`);
  return roundKg(kg);
}

/** وزن خالص = وزن پر − وزن خالی؛ وزن پر باید از وزن خالی بیشتر باشد. */
export function computeNetKg(tareKg: number, grossKg: number): number {
  const tare = assertWeightValue(tareKg, 'وزن خالی');
  const gross = assertWeightValue(grossKg, 'وزن پر');
  if (gross <= tare) throw new DispatchRuleError('وزن پر باید بیشتر از وزن خالی باشد');
  return roundKg(gross - tare);
}

/** ویرایش دستی وزن خالص: فقط با دلیل؛ مقدار باید مثبت باشد. */
export function validateNetEdit(newNetKg: number, reason: string | null | undefined): { netKg: number; reason: string } {
  const netKg = assertWeightValue(newNetKg, 'وزن خالص');
  return { netKg, reason: assertReason(reason, 'ویرایش دستی وزن خالص') };
}

// ── تعدیل اقلام فاکتور بر اساس وزن واقعی ─────────────────────────────────

export type InvoiceLineInput = { id: string; description: string; quantity: number; unitPrice: number };

export type AdjustmentInput = {
  lines: InvoiceLineInput[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  /** درصد مالیات (فقط فاکتور رسمی) */
  taxRate: number | null;
  netWeightKg: number;
  /** ردیف‌هایی که مقدارشان وزنی است؛ خالی = همه */
  weighLineIds: string[];
  /** هر واحد ردیف فاکتور چند کیلوگرم است (پیش‌فرض ۱ = مقدار ردیف به کیلوگرم) */
  kgPerUnit: number;
};

export type LineChange = {
  lineId: string;
  description: string;
  oldQty: number;
  newQty: number;
  unitPrice: number;
  oldTotal: number;
  newTotal: number;
};

export type AdjustmentResult = {
  lineChanges: LineChange[];
  oldSubtotal: number;
  newSubtotal: number;
  oldDiscount: number;
  newDiscount: number;
  oldTaxAmount: number;
  newTaxAmount: number;
  oldTotal: number;
  newTotal: number;
  changed: boolean;
};

/**
 * روش بزرگ‌ترین باقیمانده: مجموع صحیح‌های پخش‌شده دقیقاً برابر target می‌شود.
 * اگر مجموع قبلی صفر باشد، پخش یکنواخت انجام می‌شود.
 */
export function distributeUnits(oldQtys: number[], target: number): number[] {
  const n = oldQtys.length;
  if (n === 0) return [];
  const sum = oldQtys.reduce((a, b) => a + b, 0);
  const raw = oldQtys.map((q) => (sum > 0 ? (target * q) / sum : target / n));
  const floors = raw.map((r) => Math.floor(r));
  let remainder = target - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (remainder <= 0) break;
    floors[o.i] += 1;
    remainder -= 1;
  }
  return floors;
}

export function proposeInvoiceAdjustment(input: AdjustmentInput): AdjustmentResult {
  if (!(input.kgPerUnit > 0)) throw new DispatchRuleError('وزن هر واحد باید بزرگ‌تر از صفر باشد');
  const netKg = assertWeightValue(input.netWeightKg, 'وزن خالص');
  const selected = input.weighLineIds.length ? input.lines.filter((l) => input.weighLineIds.includes(l.id)) : input.lines;
  if (selected.length === 0) throw new DispatchRuleError('هیچ ردیف وزنی‌ای در فاکتور برای تعدیل پیدا نشد');

  const targetUnits = Math.round(netKg / input.kgPerUnit);
  if (targetUnits < 1) throw new DispatchRuleError('مقدار تعدیل‌شده کمتر از یک واحد می‌شود؛ وزن هر واحد را بررسی کنید');
  const newQtys = distributeUnits(
    selected.map((l) => l.quantity),
    targetUnits,
  );
  const newQtyById = new Map(selected.map((l, i) => [l.id, newQtys[i]]));

  const lineChanges: LineChange[] = input.lines.map((l) => {
    const newQty = newQtyById.get(l.id) ?? l.quantity;
    return {
      lineId: l.id,
      description: l.description,
      oldQty: l.quantity,
      newQty,
      unitPrice: l.unitPrice,
      oldTotal: l.quantity * l.unitPrice,
      newTotal: newQty * l.unitPrice,
    };
  });
  const newSubtotal = lineChanges.reduce((s, c) => s + c.newTotal, 0);
  const oldSubtotal = input.subtotal;
  // تخفیف متناسب با جمع جدید تغییر می‌کند (تخفیف ثابت اسمی نباید فاکتور را منفی کند)
  const newDiscount = oldSubtotal > 0 ? Math.min(newSubtotal, Math.round((input.discount * newSubtotal) / oldSubtotal)) : 0;
  const newTaxAmount = input.taxRate && input.taxRate > 0 ? Math.round(((newSubtotal - newDiscount) * input.taxRate) / 100) : 0;
  const newTotal = newSubtotal - newDiscount + newTaxAmount;
  const changed = lineChanges.some((c) => c.newQty !== c.oldQty);
  return {
    lineChanges,
    oldSubtotal,
    newSubtotal,
    oldDiscount: input.discount,
    newDiscount,
    oldTaxAmount: input.taxAmount,
    newTaxAmount,
    oldTotal: input.total,
    newTotal,
    changed,
  };
}

// ── دروازه‌ی نهایی‌شدن فاکتور ───────────────────────────────────────────

export type InvoiceGateFacts = {
  /** آیا برای این فاکتور بار «نیاز به وزن‌کشی» اعلام شده و هنوز لغو نشده؟ */
  needsWeighing: boolean;
  shipmentCancelled: boolean;
  weightConfirmed: boolean;
  /** وضعیت آخرین تعدیل: PROPOSED | APPLIED | REJECTED | NO_CHANGE | null */
  adjustmentStatus: string | null;
};

/** پیام مسدودکننده یا null؛ فاکتورهای بدون «نیاز به وزن‌کشی» هیچ‌وقت مسدود نمی‌شوند. */
export function invoiceFinalizationBlock(f: InvoiceGateFacts): string | null {
  if (!f.needsWeighing || f.shipmentCancelled) return null;
  if (!f.weightConfirmed) return 'نهایی‌کردن این فاکتور تا تأیید وزن نهایی بار (اعلام بار) مسدود است';
  if (f.adjustmentStatus === 'APPLIED' || f.adjustmentStatus === 'NO_CHANGE') return null;
  if (f.adjustmentStatus === 'PROPOSED') return 'تعدیل اقلام فاکتور بر اساس وزن واقعی در انتظار تأیید مدیر/حسابدار است';
  return 'تعدیل اقلام فاکتور بر اساس وزن واقعی هنوز تأیید نشده است';
}
