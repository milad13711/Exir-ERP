/**
 * حساب دقیق BigInt برای تبدیل ارز پایه. هیچ‌جا از Number/float برای مبالغ استفاده نمی‌شود:
 * نرخ یک کسر صحیح (num/den) است و گرد‌کردن صراحتاً تعریف شده.
 */

export type Rational = { num: bigint; den: bigint };

export type RoundingMode = 'STRICT' | 'ROUND';

/** سقف INT4 پستگرس — ستون‌های Int پریزما. */
export const INT4_MAX = 2_147_483_647n;
/** بزرگ‌ترین عدد صحیحِ امنِ جاوااسکریپت (پاسخ‌های JSON سیستم مبالغ BigInt را به number تبدیل می‌کنند). */
export const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

export class RateParseError extends Error {}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function reduce(r: Rational): Rational {
  const g = gcd(r.num, r.den);
  return g <= 1n ? r : { num: r.num / g, den: r.den / g };
}

const MAX_DIGITS = 18;

/**
 * نرخ را از رشته می‌خواند: «10»، «0.1»، «۰٫۱» (ارقام فارسی هم)، «1/10». عدد باید مثبت و متناهی باشد؛
 * حداکثر ۱۸ رقم تا هیچ ضربی از محدوده‌ی BigInt/numeric پستگرس بیرون نزند.
 */
export function parseRate(input: string | number): Rational {
  let s = String(input).trim();
  s = s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .replace(/\s+/g, '');
  if (!s) throw new RateParseError('نرخ تبدیل خالی است');
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const r = { num: BigInt(frac[1]!), den: BigInt(frac[2]!) };
    if (r.num === 0n || r.den === 0n) throw new RateParseError('نرخ تبدیل باید بزرگ‌تر از صفر باشد');
    if (frac[1]!.length > MAX_DIGITS || frac[2]!.length > MAX_DIGITS) throw new RateParseError('نرخ تبدیل بیش از حد بزرگ یا دقیق است');
    return reduce(r);
  }
  const dec = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!dec) throw new RateParseError('نرخ تبدیل نامعتبر است (فقط عدد مثبت، مثل ۱۰ یا ۰٫۱)');
  const intPart = dec[1]!;
  const fracPart = dec[2] ?? '';
  if (intPart.length + fracPart.length > MAX_DIGITS) throw new RateParseError('نرخ تبدیل بیش از حد بزرگ یا دقیق است');
  const num = BigInt(intPart + fracPart);
  const den = 10n ** BigInt(fracPart.length);
  if (num === 0n) throw new RateParseError('نرخ تبدیل باید بزرگ‌تر از صفر باشد');
  return reduce({ num, den });
}

export function invert(r: Rational): Rational {
  return { num: r.den, den: r.num };
}

export function multiply(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.num, den: a.den * b.den });
}

export function isIdentity(r: Rational): boolean {
  return r.num === r.den;
}

export function rationalToString(r: Rational): string {
  return r.den === 1n ? r.num.toString() : `${r.num}/${r.den}`;
}

/** value × num / den — فقط وقتی دقیق است (بدون باقی‌مانده) نتیجه می‌دهد، وگرنه null. */
export function scaleExact(value: bigint, r: Rational): bigint | null {
  const p = value * r.num;
  return p % r.den === 0n ? p / r.den : null;
}

/** گرد‌کردن «نیم به سمت دور از صفر» (قرینه برای منفی‌ها) — قاعده‌ی ROUND. */
export function scaleRounded(value: bigint, r: Rational): bigint {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const q = (abs * r.num * 2n + r.den) / (r.den * 2n);
  return neg ? -q : q;
}

export type ScaleResult = { result: bigint; exact: boolean };

export function scaleValue(value: bigint, r: Rational, mode: RoundingMode): ScaleResult {
  const exact = scaleExact(value, r);
  if (exact !== null) return { result: exact, exact: true };
  if (mode === 'STRICT') throw new RateParseError('مقدار با این نرخ به‌طور دقیق قابل تبدیل نیست');
  return { result: scaleRounded(value, r), exact: false };
}

/** آیا تبدیل `value` به این نرخ از سقف ستون عبور می‌کند؟ */
export function exceedsLimit(maxAbs: bigint, r: Rational, kind: 'int4' | 'int8'): boolean {
  const scaled = scaleRounded(maxAbs, r);
  const limit = kind === 'int4' ? INT4_MAX : SAFE_MAX;
  return scaled > limit;
}

/** برچسب‌ها و ثابت‌های ارزهای پیش‌فرض. tomanPerUnit = هر ۱ واحد این ارز چند تومان است (برای درگاه پرداخت). */
export const BASE_CURRENCY_PRESETS = [
  { code: 'IRT', label: 'تومان', tomanPerUnit: { num: 1n, den: 1n } },
  { code: 'IRR', label: 'ریال', tomanPerUnit: { num: 1n, den: 10n } },
] as const;

export function presetOf(code: string) {
  return BASE_CURRENCY_PRESETS.find((p) => p.code === code) ?? null;
}

/** نرخ پیش‌فرض بین دو ارز از پیش‌تعریف‌شده (ریال⇄تومان = ۱۰ ثابت)؛ وگرنه null (نرخ دستی لازم است). */
export function defaultRate(from: string, to: string): Rational | null {
  const a = presetOf(from);
  const b = presetOf(to);
  if (!a || !b || a.code === b.code) return null;
  // واحد جدید به‌ازای ۱ واحد قدیم = tomanPerUnit(from) / tomanPerUnit(to)
  return reduce({ num: a.tomanPerUnit.num * b.tomanPerUnit.den, den: a.tomanPerUnit.den * b.tomanPerUnit.num });
}
