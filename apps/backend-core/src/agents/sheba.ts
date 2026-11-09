/** اعتبارسنجی شماره‌ی شبا (IBAN ایران): IR + ۲۴ رقم، با کنترل mod-97. */

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی → لاتین، حذف فاصله و خط‌تیره، حروف بزرگ. */
export function normalizeSheba(input: string): string {
  let out = '';
  for (const ch of String(input ?? '')) {
    const p = PERSIAN.indexOf(ch);
    const a = ARABIC.indexOf(ch);
    out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
  }
  return out.replace(/[\s\-_.]/g, '').toUpperCase();
}

/** mod-97 روی رشته‌ی بزرگ بدون BigInt (تکه‌تکه). */
function mod97(numeric: string): number {
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    rem = Number(`${rem}${numeric.slice(i, i + 7)}`) % 97;
  }
  return rem;
}

export function isValidSheba(input: string): boolean {
  const s = normalizeSheba(input);
  if (!/^IR\d{24}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4); // BBAN + «IR» + رقم کنترل
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(numeric) === 1;
}

/** شبا را با نرمال‌سازی برمی‌گرداند یا خطای فارسی می‌اندازد. */
export function assertValidSheba(input: string): string {
  const s = normalizeSheba(input);
  if (!isValidSheba(s)) throw new Error('شماره‌ی شبا معتبر نیست (باید با IR شروع شود، ۲۶ نویسه و دارای رقم کنترل درست باشد)');
  return s;
}

export function maskSheba(sheba: string | null | undefined): string | null {
  if (!sheba) return null;
  const s = normalizeSheba(sheba);
  return s.length < 10 ? '••••' : `${s.slice(0, 4)}••••••••••••••••${s.slice(-4)}`;
}
