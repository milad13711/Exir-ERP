/** نرمال‌سازی شماره‌ی موبایل ایران → 09xxxxxxxxx (ارقام فارسی/عربی، +98، 0098، بدون صفر اول). null = نامعتبر. */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s: string): string {
  let out = '';
  for (const ch of String(s ?? '')) {
    const p = FA.indexOf(ch);
    const a = AR.indexOf(ch);
    out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
  }
  return out;
}

export function normalizeIranMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = toLatinDigits(input).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('9')) d = `0${d}`;
  return /^09\d{9}$/.test(d) ? d : null;
}

/** کلید مقایسه‌ی شماره (۱۰ رقم آخر) — برای تشخیص خود-معرفی حتی با قالب‌های متفاوت. */
export function phoneKey(input: string | null | undefined): string | null {
  const n = normalizeIranMobile(input);
  return n ? n.slice(1) : null;
}
