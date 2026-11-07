import { scaleRounded, scaleExact, SAFE_MAX, type Rational, type RoundingMode } from './rational.js';

/**
 * ستون‌های JSON که آرایه‌ای از اشیاءِ دارای فیلد مبلغ‌اند. هر فیلدِ نامبرده در هر عنصر مثل ستون‌های مبلغی با
 * ضریب تبدیل بازمقیاس می‌شود. ستون‌های JSON دیگر باید در NOT_CONVERTED (money-columns.ts) با دلیل بیایند —
 * money-columns.spec.ts هر ستون Json بدون تصمیم را رد می‌کند.
 */
export type JsonMoneyColumn = { table: string; column: string; model: string; fields: string[]; group: string };

export const JSON_MONEY_COLUMNS: JsonMoneyColumn[] = [
  { table: 'proposals', column: 'invoiceLines', model: 'Proposal', fields: ['unitPrice'], group: 'قرارداد و پروژه و پیشنهاد' },
  { table: 'reseller_settlements', column: 'lines', model: 'ResellerSettlement', fields: ['amount', 'paid', 'due'], group: 'بازاریابی و معرفی' },
  { table: 'dispatch_invoice_adjustments', column: 'lineChanges', model: 'DispatchInvoiceAdjustment', fields: ['unitPrice', 'oldTotal', 'newTotal'], group: 'فروش' },
];

export type JsonScaleResult = {
  doc: unknown;
  /** تعداد فیلدهای مبلغی که مقدارشان عوض شد یا باید عوض شود */
  cells: number;
  /** تعداد فیلدهایی که دقیق تبدیل نمی‌شوند */
  lossy: number;
  maxAbs: bigint;
  /** فیلد عددیِ غیرصحیح یا غیرعدد که دست‌نخورده ماند */
  skipped: number;
};

/** تبدیل خالص یک سند JSON (آرایه‌ی اشیاء). `mode` فقط تعیین می‌کند نتیجه‌ی نامضرب گرد شود؛ شمارش lossy همیشه انجام می‌شود. */
export function scaleJsonDoc(doc: unknown, fields: string[], rate: Rational, _mode: RoundingMode = 'ROUND'): JsonScaleResult {
  const res: JsonScaleResult = { doc, cells: 0, lossy: 0, maxAbs: 0n, skipped: 0 };
  if (!Array.isArray(doc)) return res;
  res.doc = doc.map((el) => {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return el;
    const out: Record<string, unknown> = { ...(el as Record<string, unknown>) };
    for (const f of fields) {
      const v = out[f];
      if (typeof v !== 'number') continue;
      if (!Number.isSafeInteger(v)) {
        res.skipped += 1;
        continue;
      }
      const b = BigInt(v);
      const abs = b < 0n ? -b : b;
      if (abs > res.maxAbs) res.maxAbs = abs;
      const exact = scaleExact(b, rate);
      const next = exact ?? scaleRounded(b, rate);
      if (exact === null) res.lossy += 1;
      if (next > SAFE_MAX || next < -SAFE_MAX) {
        res.skipped += 1;
        continue;
      }
      out[f] = Number(next);
      res.cells += 1;
    }
    return out;
  });
  return res;
}
