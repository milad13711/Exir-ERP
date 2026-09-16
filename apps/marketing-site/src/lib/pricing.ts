/**
 * قیمت‌گذاری این صفحه‌ی بازاریابی عمداً از قیمت واقعی نصب ماژول در پنل
 * تننت (ModuleDefinition.priceMonthly، همیشه تومان ثابت) جداست — اینجا
 * «قیمت لیست» رسمی معرفی محصول است: لنگر آن دلاری‌ست تا با نوسان ارز خودش
 * را تنظیم کند، و به تومان لحظه‌ای (از /public/catalog/exchange-rate)
 * تبدیل می‌شود. همه‌جا دلار کوچک/کمکی نمایش داده می‌شود و تومانِ
 * لحظه‌ای بزرگ/اصلی.
 *
 * قوانین قیمت‌گذاری طبق دستور صریح صاحب محصول:
 *   ۱) لایسنس دائمی کل مجموعه‌ی ماژول‌ها (FULL_LICENSE_USD) پایه‌اش ۴۹۹۹
 *      دلار بود؛ با افزوده شدن ماژول‌های تازه (که قبلاً به‌اشتباه رایگان
 *      نشان داده می‌شدند)، این عدد بالاتر رفت — طبیعی و مجاز است، ۴۹۹۹
 *      دیگر یک سقف ثابت نیست، بلکه همیشه برابر جمع واقعی وزن‌های زیر است.
 *   ۲) سهم هر ماژول براساس عرف بازار/پیچیدگی/کیفیت/نایابی آن قابلیت تعیین
 *      می‌شود، نه یک نسبت یکنواخت — ماژول‌هایی که بک‌بون ERP‌اند یا در
 *      بازار فارسی کم‌یاب/متمایزکننده‌اند (حسابداری، اتصال MCP به
 *      ChatGPT/Claude، ناوگان حمل‌ونقل) سهم بیشتری دارند؛ ابزارهای
 *      عمومی/کم‌ریسک‌تر (همگام‌سازی آفلاین، تبدیل ارز، QR) سهم کمتر. تنها
 *      «وظایف و یادآوری» واقعاً رایگان است — هیچ ماژول دیگری رایگان
 *      نیست، حتی اگر سهمش کوچک باشد.
 *   ۳) اشتراک سالانه‌ی هر ماژول، سهم خطی آن از یک بازه‌ی سازمانی است: از
 *      صفر ماژول فعال (۵۰۰$ پایه) تا همه‌ی ماژول‌ها فعال (۱۰۰۰$) — یعنی
 *      جمع اشتراک سالانه‌ی هر ترکیب دلخواهی از ماژول‌ها همیشه در بازه‌ی
 *      ۵۰۰ تا ۱۰۰۰ دلار می‌ماند، نه رشد خطی بی‌سقف.
 *   ۴) اشتراک ماهانه = سالانه ÷ ۱۰ (دو ماه رایگان، قرارداد رایج SaaS).
 *   ۵) پشتیبانی سالانه‌ی پس از خرید لایسنس یک مبلغ ثابتِ سازمانی است —
 *      ۱۹۹ دلار در سال، مستقل از تعداد/نوع ماژول‌های خریداری‌شده.
 */

/** جمع دقیق تمام وزن‌های MODULE_LICENSE_WEIGHTS_USD زیر — عمداً برابر همان جمع نگه داشته می‌شود، نه یک سقف ثابت جدا، تا هم عنوان صفحه‌ی ماژول‌ها با جمع واقعی قیمت‌ها یکی باشد و هم ضمانت بازه‌ی ۵۰۰-۱۰۰۰ دلاری bundleUsdPricing برای «همه‌ی ماژول‌ها فعال» درست بماند. */
export const FULL_LICENSE_USD = 7359;
export const ANNUAL_SUPPORT_USD = 199;
const YEARLY_BUNDLE_MIN_USD = 500;
const YEARLY_BUNDLE_MAX_USD = 1000;
const YEARLY_BUNDLE_RANGE_USD = YEARLY_BUNDLE_MAX_USD - YEARLY_BUNDLE_MIN_USD;
const MONTHLY_DIVISOR = 10;

/**
 * سهم هر ماژول از قیمت لایسنس کامل (دلار) — مجموع همه‌ی این وزن‌ها دقیقاً
 * ۴۹۹۹ دلار می‌شود. رتبه‌بندی براساس پیچیدگی/ارزش/نایابیِ واقعی هر ماژول:
 * حسابداری (بک‌بون ERP) و mcp (تنها اتصال مستقیم ChatGPT/Claude بین ERP‌های
 * فارسی) بالاترین سهم را دارند؛ ناوگان حمل‌ونقل و اتوماسیون به‌خاطر
 * نایابی‌شان در ERP فارسی سهم بالا؛ ابزارهای عمومی/کم‌ریسک (همگام‌سازی
 * آفلاین، تبدیل ارز) کمترین سهم.
 */
export const MODULE_LICENSE_WEIGHTS_USD: Record<string, number> = {
  // «وظایف و یادآوری» تنها ماژول واقعاً رایگان است — پایه‌ای و مستقل از
  // بقیه، بدون آن هم اکسیر ERP کامل کار می‌کند. هر ماژول دیگری، حتی
  // ساده‌ترین آن‌ها، برای مشتری ارزش/امکان مشخصی می‌سازد و باید قیمتی
  // داشته باشد — نبودِ یک ماژول در این جدول به‌جای رایگان بودنش، فقط یک
  // فاکتور جاافتاده بود. جمع این وزن‌ها دیگر لزوماً ۴۹۹۹ دلار نیست؛
  // ماژول‌های تازه‌اضافه‌شده رویش می‌افزایند.
  tasks: 0,
  crm: 250,
  warehouse: 250,
  accounting: 354,
  hr: 290,
  sales: 250,
  purchasing: 215,
  checks: 215,
  "supplier-risk": 180,
  "delivery-signature": 145,
  production: 290,
  "quality-control": 180,
  "ration-lab": 310,
  "api-access": 145,
  webhooks: 145,
  mcp: 360,
  "currency-exchange": 110,
  "offline-sync": 110,
  voip: 180,
  automation: 290,
  "qr-code": 100,
  recruitment: 260,
  reports: 160,
  booking: 215,
  contracts: 250,
  projects: 250,
  mentoring: 230,
  events: 280,
  forms: 150,
  warranty: 160,
  "after-sales-service": 170,
  fleet: 325,
  "online-store": 280,
  marketing: 260,
};

export type UsdPricing = { licenseUsd: number; yearlyUsd: number; monthlyUsd: number };
/** یک مبلغ با هر دو نمایش: دلار کوچک (لنگر) و تومان بزرگ (لحظه‌ای). */
export type PriceDisplay = { usd: number; toman: number };
export type TomanPricing = { monthly: PriceDisplay; yearly: PriceDisplay; license: PriceDisplay };

export function licenseWeightOf(code: string): number {
  return MODULE_LICENSE_WEIGHTS_USD[code] ?? 0;
}

/** قیمت مجزای یک ماژول به‌تنهایی (سهم آن از بازه‌ی سالانه‌ی سازمانی). */
export function usdPricingFromLicense(licenseUsd: number): UsdPricing {
  if (licenseUsd <= 0) return { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0 };
  const yearlyUsd = (licenseUsd / FULL_LICENSE_USD) * YEARLY_BUNDLE_RANGE_USD;
  return { licenseUsd, yearlyUsd, monthlyUsd: yearlyUsd / MONTHLY_DIVISOR };
}

export function sumUsdPricing(list: UsdPricing[]): UsdPricing {
  return list.reduce(
    (acc, p) => ({
      licenseUsd: acc.licenseUsd + p.licenseUsd,
      yearlyUsd: acc.yearlyUsd + p.yearlyUsd,
      monthlyUsd: acc.monthlyUsd + p.monthlyUsd,
    }),
    { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0 },
  );
}

/**
 * جمع اشتراک سالانه‌ی یک «بسته» از چند ماژول (نه یک ماژول تنها) — پایه‌ی
 * ۵۰۰ دلاری به‌علاوه‌ی سهم هرکدام از sumUsdPricing؛ چون سهم هر ماژول از
 * FULL_LICENSE_USD گرفته شده (و FULL_LICENSE_USD همان جمع کل وزن‌هاست)،
 * جمع سهم همه‌ی ماژول‌ها هرگز از ۵۰۰ دلار بیشتر نمی‌شود، پس نتیجه‌ی
 * نهایی برای هر ترکیبی، از ۵۰۰ تا ۱۰۰۰ دلار می‌ماند.
 */
export function bundleUsdPricing(sumOfModules: UsdPricing): UsdPricing {
  if (sumOfModules.licenseUsd <= 0) return { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0 };
  const yearlyUsd = YEARLY_BUNDLE_MIN_USD + sumOfModules.yearlyUsd;
  return { licenseUsd: sumOfModules.licenseUsd, yearlyUsd, monthlyUsd: yearlyUsd / MONTHLY_DIVISOR };
}

export const roundTomanToNiceNumber = (n: number) => Math.round(n / 10_000) * 10_000;

export function toToman(usd: UsdPricing, usdToToman: number): TomanPricing {
  const mk = (usdValue: number): PriceDisplay => ({
    usd: Math.round(usdValue),
    toman: roundTomanToNiceNumber(usdValue * usdToToman),
  });
  if (usd.licenseUsd <= 0) {
    const zero: PriceDisplay = { usd: 0, toman: 0 };
    return { monthly: zero, yearly: zero, license: zero };
  }
  return { monthly: mk(usd.monthlyUsd), yearly: mk(usd.yearlyUsd), license: mk(usd.licenseUsd) };
}

/** برای یک کد ماژول، مستقیم قیمت (دلار+تومان لحظه‌ای) خودِ همان ماژول را برمی‌گرداند. */
export function moduleTomanPricing(code: string, usdToToman: number): TomanPricing {
  return toToman(usdPricingFromLicense(licenseWeightOf(code)), usdToToman);
}

/** پشتیبانی سالانه‌ی پس از خرید لایسنس — مبلغ ثابت سازمانی، مستقل از ماژول‌ها. */
export function annualSupportPricing(usdToToman: number): PriceDisplay {
  return { usd: ANNUAL_SUPPORT_USD, toman: roundTomanToNiceNumber(ANNUAL_SUPPORT_USD * usdToToman) };
}
