/**
 * پاک‌سازی متن ساده‌ی ورودی: کاراکترهای کنترلی (به‌جز \t \n \r)، و کاراکترهای جهت‌دهی دوسویه که برای جعل نمایش
 * (Trojan-Source / spoofing شماره و نام) به‌کار می‌روند: ایزوله‌ها U+2066–2069 و embedding/override U+202A–202E.
 * علامت‌های RLM/LRM (U+200E/F) و ZWNJ (U+200C) برای فارسی لازم‌اند و می‌مانند.
 */
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

export function cleanText(s: string): string {
  return s.replace(BAD, '');
}

/** برای class-transformer: رشته یا آرایه‌ی رشته را پاک می‌کند. */
export function cleanValue(v: unknown): unknown {
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? cleanText(x) : x));
  return v;
}
