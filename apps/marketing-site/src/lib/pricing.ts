/**
 * سه حالت خرید هر ماژول از یک عدد پایه (قیمت اشتراک ماهانه‌ی موجود در کاتالوگ)
 * مشتق می‌شود — نه یک ستون جدا در دیتابیس — تا وقتی صاحب کسب‌وکار قیمت
 * ماهانه‌ی یک ماژول را تغییر می‌دهد، هر سه حالت خودکار و بدون واگرایی
 * به‌روز بمانند. ضرایب مطابق قرارداد رایج بازار نرم‌افزار سازمانی ایران:
 * اشتراک سالانه ≈ ۱۰ برابر ماهانه (دو ماه رایگان)، خرید لایسنس یک‌باره
 * ≈ ۳۰ برابر ماهانه (بازگشت سرمایه‌ی مشتری در حدود ۲.۵ سال نسبت به اشتراک
 * ماهانه)، پشتیبانی سالانه‌ی پس از خرید لایسنس ≈ ۲۰٪ قیمت لایسنس (استاندارد
 * رایج نگهداری نرم‌افزار سازمانی).
 */

export type ModulePricing = {
  monthly: number;
  yearly: number;
  yearlySavingsPercent: number;
  license: number;
  annualSupport: number;
};

const roundTo10k = (n: number) => Math.round(n / 10_000) * 10_000;

export function deriveModulePricing(priceMonthly: number): ModulePricing {
  if (priceMonthly === 0) {
    return { monthly: 0, yearly: 0, yearlySavingsPercent: 0, license: 0, annualSupport: 0 };
  }
  const yearly = roundTo10k(priceMonthly * 10);
  const license = roundTo10k(priceMonthly * 30);
  const annualSupport = roundTo10k(license * 0.2);
  const yearlySavingsPercent = Math.round((1 - yearly / (priceMonthly * 12)) * 100);
  return { monthly: priceMonthly, yearly, yearlySavingsPercent, license, annualSupport };
}

export function sumPricing(list: ModulePricing[]): ModulePricing {
  const sum = list.reduce(
    (acc, p) => ({
      monthly: acc.monthly + p.monthly,
      yearly: acc.yearly + p.yearly,
      license: acc.license + p.license,
      annualSupport: acc.annualSupport + p.annualSupport,
    }),
    { monthly: 0, yearly: 0, license: 0, annualSupport: 0 },
  );
  const yearlySavingsPercent = sum.monthly > 0 ? Math.round((1 - sum.yearly / (sum.monthly * 12)) * 100) : 0;
  return { ...sum, yearlySavingsPercent };
}
