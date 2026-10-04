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
 *   ۳) اشتراک سالانه‌ی هر ماژول = لایسنس ÷ ۴ (بازگشت سرمایه‌ی ۴ ساله)؛ قیمت
 *      یک بسته دقیقاً جمع قیمت ماژول‌هایش است — بدون پایه‌ی ثابت.
 *   ۴) اشتراک ماهانه = سالانه ÷ ۱۰ (دو ماه رایگان، قرارداد رایج SaaS).
 *   ۵) پشتیبانی سالانه‌ی پس از خرید لایسنس یک مبلغ ثابتِ سازمانی است —
 *      ۱۹۹ دلار در سال، مستقل از تعداد/نوع ماژول‌های خریداری‌شده.
 */

/** همان قاعده‌ی سرور (backend module-license-usd.ts): ماهانه = قیمت پایه ÷ ۴۰ (ثابت)، سالانه = ۵ برابر ماهانه، لایسنس = ۶ برابر سالانه. */
const BASE_TO_MONTHLY_DIVISOR = 40;
const YEARLY_TO_MONTHLY_MULTIPLIER = 5;
const LICENSE_TO_YEARLY_MULTIPLIER = 6;

/** جمع دقیق تمام وزن‌های MODULE_LICENSE_WEIGHTS_USD زیر؛ عنوان صفحه‌ی ماژول‌ها همیشه با جمع واقعی قیمت‌ها یکی است. */
export const FULL_LICENSE_USD = Math.round((11775 * LICENSE_TO_YEARLY_MULTIPLIER * YEARLY_TO_MONTHLY_MULTIPLIER) / BASE_TO_MONTHLY_DIVISOR);
export const ANNUAL_SUPPORT_USD = 199;


/**
 * سهم هر ماژول از قیمت لایسنس کامل (دلار) — مجموع همه‌ی این وزن‌ها دقیقاً
 * ۴۹۹۹ دلار می‌شود. رتبه‌بندی براساس پیچیدگی/ارزش/نایابیِ واقعی هر ماژول:
 * حسابداری (بک‌بون ERP) و mcp (تنها اتصال مستقیم ChatGPT/Claude بین ERP‌های
 * فارسی) بالاترین سهم را دارند؛ ناوگان حمل‌ونقل و اتوماسیون به‌خاطر
 * نایابی‌شان در ERP فارسی سهم بالا؛ ابزارهای عمومی/کم‌ریسک (همگام‌سازی
 * آفلاین، تبدیل ارز) کمترین سهم.
 */
export const MODULE_LICENSE_WEIGHTS_USD: Record<string, number> = {
  "tasks": 0,
  "daily-checklist": 0,
  "crm": 400,
  "warehouse": 400,
  "accounting": 565,
  "hr": 465,
  "sales": 400,
  "purchasing": 345,
  "checks": 345,
  "supplier-risk": 290,
  "delivery-signature": 230,
  "production": 465,
  "quality-control": 290,
  "ration-lab": 495,
  "api-access": 230,
  "webhooks": 230,
  "mcp": 575,
  "currency-exchange": 175,
  "offline-sync": 175,
  "voip": 290,
  "automation": 465,
  "qr-code": 160,
  "recruitment": 415,
  "reports": 255,
  "booking": 345,
  "contracts": 400,
  "projects": 400,
  "mentoring": 370,
  "events": 450,
  "forms": 240,
  "warranty": 255,
  "after-sales-service": 270,
  "fleet": 520,
  "online-store": 450,
  "marketing": 415,
};

export type UsdPricing = { licenseUsd: number; yearlyUsd: number; monthlyUsd: number };
/** یک مبلغ با هر دو نمایش: دلار کوچک (لنگر) و تومان بزرگ (لحظه‌ای). */
export type PriceDisplay = { usd: number; toman: number };
export type TomanPricing = { monthly: PriceDisplay; yearly: PriceDisplay; license: PriceDisplay };

export function licenseWeightOf(code: string): number {
  return MODULE_LICENSE_WEIGHTS_USD[code] ?? 0;
}

/** قیمت مجزای یک ماژول به‌تنهایی (سهم آن از بازه‌ی سالانه‌ی سازمانی). */
export function usdPricingFromLicense(baseUsd: number): UsdPricing {
  if (baseUsd <= 0) return { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0 };
  const monthlyUsd = baseUsd / BASE_TO_MONTHLY_DIVISOR;
  const yearlyUsd = monthlyUsd * YEARLY_TO_MONTHLY_MULTIPLIER;
  return { licenseUsd: yearlyUsd * LICENSE_TO_YEARLY_MULTIPLIER, yearlyUsd, monthlyUsd };
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

/** قیمت یک «بسته» از چند ماژول = جمع قیمت ماژول‌ها (همان sumUsdPricing). */
export function bundleUsdPricing(sumOfModules: UsdPricing): UsdPricing {
  if (sumOfModules.licenseUsd <= 0) return { licenseUsd: 0, yearlyUsd: 0, monthlyUsd: 0 };
  // جمع ساده‌ی ماژول‌ها — بدون پایه‌ی ثابت؛ قیمت هر بسته دقیقاً مجموع قیمت ماژول‌هایش است
  return sumOfModules;
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
