import { describe, expect, it } from 'vitest';
import {
  INT4_MAX,
  RateParseError,
  defaultRate,
  exceedsLimit,
  invert,
  parseRate,
  rationalToString,
  scaleExact,
  scaleRounded,
  scaleValue,
} from './rational.js';

describe('parseRate', () => {
  it('اعداد صحیح، اعشاری، کسری و ارقام فارسی', () => {
    expect(parseRate('10')).toEqual({ num: 10n, den: 1n });
    expect(parseRate('0.1')).toEqual({ num: 1n, den: 10n });
    expect(parseRate('۰٫۱')).toEqual({ num: 1n, den: 10n });
    expect(parseRate('1/10')).toEqual({ num: 1n, den: 10n });
    expect(parseRate('0.000024')).toEqual({ num: 3n, den: 125000n });
    expect(parseRate(10)).toEqual({ num: 10n, den: 1n });
  });
  it.each(['', '0', '-5', 'abc', '1e3', '0/5', '5/0', '1234567890123456789'])('نرخ نامعتبر رد می‌شود: %s', (bad) => {
    expect(() => parseRate(bad)).toThrow(RateParseError);
  });
  it('نرخ پیش‌فرض ریال⇄تومان ۱۰ و ۱/۱۰', () => {
    expect(defaultRate('IRT', 'IRR')).toEqual({ num: 10n, den: 1n });
    expect(defaultRate('IRR', 'IRT')).toEqual({ num: 1n, den: 10n });
    expect(defaultRate('IRT', 'USD')).toBeNull();
    expect(invert({ num: 10n, den: 1n })).toEqual({ num: 1n, den: 10n });
    expect(rationalToString({ num: 1n, den: 10n })).toBe('1/10');
  });
});

describe('scale (BigInt exact)', () => {
  const x10 = parseRate('10');
  const d10 = parseRate('0.1');
  it('×۱۰ دقیق و بدون float', () => {
    expect(scaleExact(123_456_789_012n, x10)).toBe(1_234_567_890_120n);
    expect(scaleExact(-5n, x10)).toBe(-50n);
  });
  it('÷۱۰ فقط برای مضرب‌های ۱۰ دقیق است', () => {
    expect(scaleExact(1230n, d10)).toBe(123n);
    expect(scaleExact(1234n, d10)).toBeNull();
  });
  it('قاعده‌ی گرد‌کردن: نیم به سمت دور از صفر، متقارن برای منفی', () => {
    expect(scaleRounded(1234n, d10)).toBe(123n);
    expect(scaleRounded(1235n, d10)).toBe(124n);
    expect(scaleRounded(15n, d10)).toBe(2n);
    expect(scaleRounded(14n, d10)).toBe(1n);
    expect(scaleRounded(-15n, d10)).toBe(-2n);
    expect(scaleRounded(-14n, d10)).toBe(-1n);
    expect(scaleRounded(4n, d10)).toBe(0n);
    expect(scaleRounded(5n, d10)).toBe(1n);
  });
  it('STRICT مقدار غیردقیق را رد می‌کند، ROUND گرد می‌کند', () => {
    expect(() => scaleValue(1234n, d10, 'STRICT')).toThrow();
    expect(scaleValue(1234n, d10, 'ROUND')).toEqual({ result: 123n, exact: false });
    expect(scaleValue(1230n, d10, 'STRICT')).toEqual({ result: 123n, exact: true });
  });
  it('رفت‌وبرگشت ×۱۰ و ÷۱۰ دقیقاً همان مقدار را برمی‌گرداند (بدون drift)', () => {
    for (const v of [0n, 1n, 999n, 2_147_483_647n, 9_007_199_254_740_991n, -12345n]) {
      const up = scaleExact(v, x10)!;
      expect(scaleExact(up, d10)).toBe(v);
    }
  });
  it('نرخ دلخواه (۱ تومان = ۰٫۰۰۰۰۲۴ دلار) دقیق با کسر کار می‌کند', () => {
    const r = parseRate('0.000024');
    expect(scaleRounded(50_000_000n, r)).toBe(1200n);
    expect(scaleExact(41_667n, r)).toBeNull();
  });
});

describe('سقف ستون', () => {
  it('ضرب ×۱۰ مقدار بالای ۲۱۴٬۷۴۸٬۳۶۴ برای INT4 سرریز است', () => {
    expect(exceedsLimit(214_748_364n, parseRate('10'), 'int4')).toBe(false);
    expect(exceedsLimit(214_748_365n, parseRate('10'), 'int4')).toBe(true);
    expect(INT4_MAX).toBe(2_147_483_647n);
  });
  it('BigInt ستون‌ها تا عدد امن جاوااسکریپت', () => {
    expect(exceedsLimit(900_719_925_474_099n, parseRate('10'), 'int8')).toBe(false);
    expect(exceedsLimit(900_719_925_474_100n, parseRate('10'), 'int8')).toBe(true);
  });
});
