/** تبدیل مبلغ رویداد ورودی به «واحد پایه‌ی تننت» (ارز پایه‌ی فعلی). فقط ارزهای ایرانی پشتیبانی می‌شوند. */
import { scaleExact, scaleRounded, type Rational } from '../base-currency/rational.js';

/** هر ۱ واحد این ارز چند تومان است. */
const TOMAN_PER: Record<string, Rational> = {
  IRT: { num: 1n, den: 1n },
  TOMAN: { num: 1n, den: 1n },
  IRR: { num: 1n, den: 10n },
  RIAL: { num: 1n, den: 10n },
};

export const SUPPORTED_EVENT_CURRENCIES = Object.keys(TOMAN_PER);
export const MAX_EVENT_AMOUNT = 2_000_000_000;

export class UnsupportedCurrencyError extends Error {}
export class InexactAmountError extends Error {}

/**
 * amount (ارز رویداد) → واحد پایه‌ی تننت. base.tomanPerUnit = هر ۱ واحد پایه چند تومان.
 * مبلغ در واحد پایه = amount × (tomanPerEventUnit / tomanPerBaseUnit). اگر نتیجه صحیح نشود خطا می‌دهد (گرد نمی‌کند).
 */
export function toBaseUnit(amount: number, currency: string, base: { code: string; tomanPerUnit: Rational }): number {
  const cur = currency.toUpperCase();
  const f = TOMAN_PER[cur];
  if (!f && cur !== base.code) throw new UnsupportedCurrencyError(`ارز «${currency}» پشتیبانی نمی‌شود (IRT یا IRR)`);
  if (!Number.isInteger(amount) || amount < 0) throw new InexactAmountError('مبلغ باید عدد صحیح نامنفی باشد');
  if (!f) return amount; // ارز رویداد = ارز پایه‌ی تننت
  // base = amount × (tomanPerEventUnit ÷ tomanPerBaseUnit) — یک ضریب گویا، تا ریال→ریال هیچ‌گاه ناصحیح نشود
  const ratio: Rational = { num: f.num * base.tomanPerUnit.den, den: f.den * base.tomanPerUnit.num };
  const inBase = scaleExact(BigInt(amount), ratio);
  if (inBase === null) throw new InexactAmountError('مبلغ پس از تبدیل به واحد پایه صحیح نمی‌شود');
  if (inBase > BigInt(MAX_EVENT_AMOUNT)) throw new InexactAmountError('مبلغ بیش از حد بزرگ است');
  return Number(inBase);
}

/** مبلغ پیش‌فرض (تومان) → واحد پایه (گرد)، با حداقل ۱. */
export function tomanToBase(toman: number, base: { tomanPerUnit: Rational }): number {
  const v = scaleRounded(BigInt(toman), { num: base.tomanPerUnit.den, den: base.tomanPerUnit.num });
  return Math.max(1, Number(v));
}
