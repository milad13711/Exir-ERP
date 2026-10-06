/**
 * منبع واحد قیمت پایه‌ی دلاری (لایسنس مادام‌العمر) هر ماژول — همه‌ی قیمت‌ها از همین‌جا مشتق می‌شوند:
 *   «قیمت پایه» (این جدول، دلار) ثابت‌کننده‌ی قیمت ماهانه است: ماهانه = پایه ÷ ۴۰ ؛ سپس سالانه = ۵ برابر ماهانه
 *   و لایسنس = ۶ برابر سالانه (= ۳۰ برابر ماهانه، یعنی ۰٫۷۵ برابر قیمت پایه).
 *   (نام فیلد «licenseUsd» از قدیم مانده؛ معنای آن اکنون «قیمت پایه‌ی دلاری» است.)
 * تومان = دلار × نرخ لحظه‌ای و گردشده به هزار تومان. مقیاس طوری تنظیم شده که یک ERP کارخانه‌ای با
 * ۱۰ تا ۱۵ ماژول فعال حدود ۱ میلیارد تومان لایسنس شود. سایت بازاریابی (marketing-site/src/lib/pricing.ts)
 * دقیقاً همین جدول را دارد و تست pricing-parity.spec.ts هم‌ارزی‌شان را تضمین می‌کند.
 * «وظایف و یادآوری» تنها ماژول رایگان است.
 */
export const MODULE_LICENSE_USD: Record<string, number> = {
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
  "proposals": 350,
  "forms": 240,
  "warranty": 255,
  "after-sales-service": 270,
  "fleet": 520,
  "online-store": 450,
  "marketing": 415,
  "tax": 450,
};

/** قیمت ماهانه‌ی دلاری = قیمت پایه ÷ ۴۰ (ثابت؛ همان ماهانه‌ی پیش از تغییر ضریب‌ها). */
export const BASE_TO_MONTHLY_DIVISOR = 40;
/** سالانه = ۵ برابر ماهانه؛ لایسنس = ۶ برابر سالانه. (نام «DIVISOR» از قدیم مانده؛ هر دو ضریب‌اند.) */
export const YEARLY_TO_MONTHLY_DIVISOR = 5;
export const LICENSE_TO_YEARLY_DIVISOR = 6;

export type DerivedModulePrices = { monthly: number; yearly: number; license: number };

/** قیمت‌های تومانی سازگار یک ماژول از روی قیمت پایه‌ی دلاری. صفر یعنی رایگان. */
export function deriveModulePrices(licenseUsd: number, usdToToman: number): DerivedModulePrices {
  if (licenseUsd <= 0 || usdToToman <= 0) return { monthly: 0, yearly: 0, license: 0 };
  const monthlyExact = (licenseUsd * usdToToman) / BASE_TO_MONTHLY_DIVISOR;
  const monthly = Math.max(1000, Math.round(monthlyExact / 1000) * 1000);
  const yearly = monthly * YEARLY_TO_MONTHLY_DIVISOR;
  return { monthly, yearly, license: yearly * LICENSE_TO_YEARLY_DIVISOR };
}
