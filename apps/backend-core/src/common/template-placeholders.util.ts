/**
 * جایگزینی فیلدهای پویا به‌شکل {{نام_فیلد}} در یک متن. کلید ناشناخته دست‌نخورده می‌ماند تا یک
 * غلط تایپی کل سند را خراب نکند و کاربر بتواند آن را ببیند و اصلاح کند.
 */
export function fillPlaceholders(body: string, values: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key: string) => {
    const v = values[key.trim()];
    return v === undefined || v === null || v === '' ? match : String(v);
  });
}
