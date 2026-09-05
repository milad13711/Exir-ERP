import { toJalaliDate } from '../common/jalali.js';

/**
 * تعطیلات رسمی ایران — به تفکیک سال شمسی، چون بخشی از تعطیلات (مناسبت‌های
 * قمری مثل تاسوعا/عاشورا/اربعین/عید فطر/عید قربان/غدیر) هرسال چند روز نسبت
 * به تقویم شمسی جابه‌جا می‌شوند و باید سالانه به‌روزرسانی شوند؛ تعطیلات ثابت
 * (نوروز، ۱۲/۱۳ فروردین، ۱۴ خرداد، ۲۲ بهمن، ...) هر سال یکسان‌اند.
 * فقط برای غیرفعال‌کردن رزرو آنلاین در روزهای تعطیل استفاده می‌شود — رزرو
 * داخلی توسط پرسنل هرگز توسط این لیست محدود نمی‌شود.
 */
const FIXED_HOLIDAYS: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "نوروز" },
  { month: 1, day: 2, name: "نوروز" },
  { month: 1, day: 3, name: "نوروز" },
  { month: 1, day: 4, name: "نوروز" },
  { month: 1, day: 12, name: "روز جمهوری اسلامی" },
  { month: 1, day: 13, name: "روز طبیعت (سیزده‌به‌در)" },
  { month: 3, day: 14, name: "رحلت امام خمینی" },
  { month: 3, day: 15, name: "قیام ۱۵ خرداد" },
  { month: 11, day: 22, name: "پیروزی انقلاب اسلامی" },
  { month: 12, day: 29, name: "روز ملی شدن صنعت نفت" },
];

/** تعطیلات قمری/متغیر — تاریخ شمسی معادل هرسال باید جداگانه محاسبه و به‌روزرسانی شود. */
const YEARLY_HOLIDAYS: Record<number, Array<{ month: number; day: number; name: string }>> = {
  1404: [
    { month: 4, day: 26, name: "عید غدیر خم" },
    { month: 6, day: 3, name: "تاسوعای حسینی" },
    { month: 6, day: 4, name: "عاشورای حسینی" },
    { month: 6, day: 13, name: "اربعین حسینی" },
    { month: 6, day: 21, name: "رحلت رسول اکرم / شهادت امام حسن مجتبی" },
    { month: 6, day: 23, name: "شهادت امام رضا (ع)" },
    { month: 6, day: 30, name: "شهادت امام حسن عسکری (ع)" },
    { month: 7, day: 9, name: "میلاد پیامبر اکرم و امام جعفر صادق (ع)" },
  ],
  1405: [
    { month: 4, day: 15, name: "عید غدیر خم" },
    { month: 5, day: 23, name: "تاسوعای حسینی" },
    { month: 5, day: 24, name: "عاشورای حسینی" },
    { month: 6, day: 3, name: "اربعین حسینی" },
    { month: 6, day: 11, name: "رحلت رسول اکرم / شهادت امام حسن مجتبی" },
    { month: 6, day: 13, name: "شهادت امام رضا (ع)" },
    { month: 6, day: 20, name: "شهادت امام حسن عسکری (ع)" },
    { month: 6, day: 29, name: "میلاد پیامبر اکرم و امام جعفر صادق (ع)" },
  ],
};

export function iranHolidaysForYear(jalaliYear: number): Array<{ month: number; day: number; name: string }> {
  return [...FIXED_HOLIDAYS, ...(YEARLY_HOLIDAYS[jalaliYear] ?? [])];
}

export function isIranHoliday(jalaliYear: number, jalaliMonth: number, jalaliDay: number): boolean {
  return iranHolidaysForYear(jalaliYear).some((h) => h.month === jalaliMonth && h.day === jalaliDay);
}

export function isDateIranHoliday(date: Date): boolean {
  const { year, month, day } = toJalaliDate(date);
  return isIranHoliday(year, month, day);
}
