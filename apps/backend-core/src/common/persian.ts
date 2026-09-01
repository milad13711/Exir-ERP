const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** Converts ASCII digits in a string/number to Persian digits. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Formats a number with Persian thousand separators ("٬") and Persian digits. */
export function formatNumber(value: number): string {
  const grouped = Math.round(value).toLocaleString('en-US').replace(/,/g, '٬');
  return toPersianDigits(grouped);
}

/** Formats a Toman amount with thousand separators and a trailing unit label. */
export function formatToman(value: number): string {
  return `${formatNumber(value)} تومان`;
}

/** Gregorian -> Jalali (Shamsi) conversion, algorithm per the jalaali calendar spec. */
export function toJalali(date: Date): { year: number; month: number; day: number } {
  const g2d = (gy: number, gm: number, gd: number) => {
    const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let d =
      355666 +
      365 * gy +
      Math.floor((gy + 3) / 4) -
      Math.floor((gy + 99) / 100) +
      Math.floor((gy + 399) / 400) +
      gd +
      gDaysInMonth[gm - 1];
    if (gm > 2 && (gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0))) d += 1;
    return d;
  };
  const d2j = (jdn: number) => {
    let jy = -1595 + 33 * Math.floor(jdn / 12053);
    jdn %= 12053;
    jy += 4 * Math.floor(jdn / 1461);
    jdn %= 1461;
    if (jdn > 365) {
      jy += Math.floor((jdn - 1) / 365);
      jdn = (jdn - 1) % 365;
    }
    const jDaysInMonth = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
    let jm = 0;
    let jd = jdn + 1;
    for (let i = 0; i < 12; i++) {
      if (jd <= jDaysInMonth[i]) {
        jm = i + 1;
        break;
      }
      jd -= jDaysInMonth[i];
      jm = 12;
    }
    return { year: jy, month: jm, day: jd };
  };
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
  return d2j(g2d(gy, gm, gd));
}

/** Compact numeric display like "۱۴۰۵/۰۷/۰۱". */
export function formatJalaliDate(date: Date): string {
  const { year, month, day } = toJalali(date);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return toPersianDigits(`${year}/${mm}/${dd}`);
}

/** Full display string like "۶ شهریور ۱۴۰۵". */
export function formatJalaliFull(date: Date): string {
  const { year, month, day } = toJalali(date);
  return `${toPersianDigits(day)} ${JALALI_MONTHS[month - 1]} ${toPersianDigits(year)}`;
}
