/**
 * قیمت‌گذاری این صفحه‌ی بازاریابی عمداً از قیمت واقعی نصب ماژول در پنل
 * تننت (ModuleDefinition.priceMonthly، همیشه تومان ثابت) جداست — اینجا
 * «قیمت لیست» رسمی معرفی محصول است: لنگر آن دلاری‌ست تا با نوسان ارز خودش
 * را تنظیم کند، و به تومان لحظه‌ای (از /public/catalog/exchange-rate)
 * تبدیل می‌شود. رابطه‌ی سه حالت خرید، طبق دستور صریح صاحب محصول:
 *   لایسنس دائمی کل مجموعه‌ی ماژول‌ها ≈ ۴۹۹۹ دلار
 *   لایسنس ≈ ۷ برابر اشتراک سالانه
 *   اشتراک سالانه ≈ ۱۰ برابر اشتراک ماهانه (دو ماه رایگان، قرارداد رایج SaaS)
 *   پشتیبانی سالانه‌ی پس از خرید لایسنس = ۱۰٪ مبلغ لایسنس، فقط برای همان
 *   ماژول‌های خریداری‌شده — ماژول جدید بعداً جداگانه قیمت‌گذاری می‌شود.
 */

export const FULL_LICENSE_USD = 4999;
const YEARLY_DIVISOR = 7;
const MONTHLY_DIVISOR = 10;
const ANNUAL_SUPPORT_RATE = 0.1;

/**
 * سهم هر ماژول از قیمت لایسنس کامل (دلار) — مجموع همه‌ی این وزن‌ها دقیقاً
 * ۴۹۹۹ دلار می‌شود. نسبت‌ها همان تراز پیچیدگی/ارزش قبلی ماژول‌ها را حفظ
 * می‌کند (حسابداری و منابع انسانی سنگین‌تر، ماژول‌های یکپارچه‌سازی سبک‌تر).
 */
export const MODULE_LICENSE_WEIGHTS_USD: Record<string, number> = {
  tasks: 0,
  crm: 215,
  warehouse: 215,
  accounting: 550,
  hr: 450,
  sales: 340,
  purchasing: 340,
  checks: 215,
  "supplier-risk": 110,
  "delivery-signature": 110,
  production: 340,
  "quality-control": 215,
  "api-access": 110,
  webhooks: 110,
  mcp: 215,
  "currency-exchange": 110,
  "offline-sync": 110,
  voip: 215,
  automation: 169,
  booking: 215,
  contracts: 215,
  projects: 215,
  fleet: 215,
};

export type UsdPricing = { licenseUsd: number; yearlyUsd: number; monthlyUsd: number; annualSupportUsd: number };
export type TomanPricing = {
  monthly: number;
  yearly: number;
  license: number;
  annualSupport: number;
  yearlySavingsPercent: number;
};

export function licenseWeightOf(code: string): number {
  return MODULE_LICENSE_WEIGHTS_USD[code] ?? 0;
}

export function usdPricingFromLicense(licenseUsd: number): UsdPricing {
  if (licenseUsd <= 0) return { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0, annualSupportUsd: 0 };
  const yearlyUsd = licenseUsd / YEARLY_DIVISOR;
  const monthlyUsd = yearlyUsd / MONTHLY_DIVISOR;
  return { licenseUsd, yearlyUsd, monthlyUsd, annualSupportUsd: licenseUsd * ANNUAL_SUPPORT_RATE };
}

export function sumUsdPricing(list: UsdPricing[]): UsdPricing {
  return list.reduce(
    (acc, p) => ({
      licenseUsd: acc.licenseUsd + p.licenseUsd,
      yearlyUsd: acc.yearlyUsd + p.yearlyUsd,
      monthlyUsd: acc.monthlyUsd + p.monthlyUsd,
      annualSupportUsd: acc.annualSupportUsd + p.annualSupportUsd,
    }),
    { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0, annualSupportUsd: 0 },
  );
}

const roundTo10k = (n: number) => Math.round(n / 10_000) * 10_000;

export function toToman(usd: UsdPricing, usdToToman: number): TomanPricing {
  if (usd.licenseUsd <= 0) return { monthly: 0, yearly: 0, license: 0, annualSupport: 0, yearlySavingsPercent: 0 };
  const monthly = roundTo10k(usd.monthlyUsd * usdToToman);
  const yearly = roundTo10k(usd.yearlyUsd * usdToToman);
  const license = roundTo10k(usd.licenseUsd * usdToToman);
  const annualSupport = roundTo10k(usd.annualSupportUsd * usdToToman);
  const yearlySavingsPercent = monthly > 0 ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
  return { monthly, yearly, license, annualSupport, yearlySavingsPercent };
}

/** برای یک کد ماژول، مستقیم قیمت تومانی (بر مبنای نرخ لحظه‌ای) برمی‌گرداند. */
export function moduleTomanPricing(code: string, usdToToman: number): TomanPricing {
  return toToman(usdPricingFromLicense(licenseWeightOf(code)), usdToToman);
}
