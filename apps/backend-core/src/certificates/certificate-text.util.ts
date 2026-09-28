import { escapeHtml } from '../common/pdf-font.js';

/** حداکثر ردیف در هر ستونِ آیتم‌ها. */
export const ITEMS_MAX_ROWS = 4;

export const BODY_PLACEHOLDERS = [
  'recipientName',
  'nationalId',
  'title',
  'companyName',
  'startDate',
  'endDate',
  'durationHours',
  'score',
  'issueDate',
  'code',
] as const;

export type BodyPlaceholder = (typeof BODY_PLACEHOLDERS)[number];

/**
 * جایگزینی {placeholder}ها در متن گواهی. مقدارهای ناموجود خالی می‌شوند،
 * نگه‌دارنده‌ی ناشناخته دست‌نخورده می‌ماند، فاصله‌های دوبل/فاصله‌ی پیش از
 * ویرگول جمع می‌شوند. خروجی خام (بدون escape) است؛ escape در لایه‌ی HTML انجام می‌شود.
 */
export function substituteBodyText(template: string, values: Partial<Record<string, string | null | undefined>>): string {
  const known = new Set<string>(BODY_PLACEHOLDERS);
  const out = template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!known.has(key)) return match;
    return values[key] ?? '';
  });
  return out
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.،؛])/g, '$1')
        .trim(),
    )
    .join('\n');
}

/** متن چندخطی → HTML امن (escape کامل + <br> برای خط جدید). */
export function bodyTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function maxItemsFor(columns: number): number {
  return columns * ITEMS_MAX_ROWS;
}

/**
 * پخش آیتم‌ها ستون‌به‌ستون (بالا به پایین)، حداکثر ۴ ردیف در هر ستون.
 * آیتم‌های بیش از ظرفیت (ستون × ۴) حذف می‌شوند.
 */
export function distributeItemsIntoColumns<T>(items: T[], columns: number): T[][] {
  const cols = Math.max(1, Math.min(3, Math.floor(columns) || 2));
  const capped = items.slice(0, maxItemsFor(cols));
  const result: T[][] = [];
  for (let c = 0; c < cols; c++) {
    const chunk = capped.slice(c * ITEMS_MAX_ROWS, (c + 1) * ITEMS_MAX_ROWS);
    if (chunk.length) result.push(chunk);
  }
  return result;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** ارقام فارسی/عربی → ASCII (برای ذخیره‌ی شماره ملی). */
export function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = PERSIAN_INDIC.indexOf(d);
    return String(i >= 0 ? i : ARABIC_INDIC.indexOf(d));
  });
}
