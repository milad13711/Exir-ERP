const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const WEEKDAYS_FA = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
  "شنبه",
];
export const WEEKDAYS_SHORT_FA = ["ی", "د", "س", "چ", "پ", "ج", "ش"];
export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

/** Converts ASCII digits in a string/number to Persian digits. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Formats a number with Persian thousand separators ("٬") and Persian digits. */
export function formatNumber(value: number): string {
  const grouped = Math.round(value).toLocaleString("en-US").replace(/,/g, "٬");
  return toPersianDigits(grouped);
}

/** Formats a Toman amount with thousand separators and a trailing unit label. */
export function formatToman(value: number): string {
  return `${formatNumber(value)} تومان`;
}

// Gregorian <-> Jalali (Shamsi) conversion — the standard jalaali algorithm
// (leap-year break-point table), ported so toJalali/toGregorian are exact
// inverses of each other. Internal helpers use true Julian day numbers.
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}
const JALALI_BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = JALALI_BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/** Gregorian -> Jalali (Shamsi) conversion. */
export function toJalali(date: Date): { year: number; month: number; day: number } {
  const jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const { jy, jm, jd } = d2j(jdn);
  return { year: jy, month: jm, day: jd };
}

/** Jalali (Shamsi) -> Gregorian conversion — the exact inverse of toJalali. */
export function toGregorian(jy: number, jm: number, jd: number): Date {
  const jdn = j2d(jy, jm, jd);
  const { gy, gm, gd } = d2g(jdn);
  return new Date(gy, gm - 1, gd);
}

/** Number of days in a given Jalali month (handles the leap-year 30th of Esfand). */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalCal(jy).leap === 0 ? 30 : 29;
}

/** "سارا محمدی" -> "س‌م" (first letter of each of the first two words, joined by ZWNJ). */
export function getInitials(name: string | null | undefined): string {
  if (!name) return "؟";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("‌");
}

/** Full display string like "شنبه، ۶ شهریور ۱۴۰۵". */
export function formatJalaliFull(date: Date = new Date()): string {
  const { year, month, day } = toJalali(date);
  const weekday = WEEKDAYS_FA[date.getDay()];
  return `${weekday}، ${toPersianDigits(day)} ${JALALI_MONTHS[month - 1]} ${toPersianDigits(year)}`;
}

/** Compact numeric display like "۱۴۰۵/۰۷/۰۱". */
export function formatJalaliDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const { year, month, day } = toJalali(d);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return toPersianDigits(`${year}/${mm}/${dd}`);
}

/** Compact date + time, like "۱۴۰۵/۰۷/۰۱ ۱۴:۳۰" — omits the time when it's exactly midnight (date-only value). */
export function formatJalaliDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const datePart = formatJalaliDate(d);
  if (d.getHours() === 0 && d.getMinutes() === 0) return datePart;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${datePart} ${toPersianDigits(`${hh}:${mm}`)}`;
}

/** Converts a Date to the value a `datetime-local` input expects, in local time. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
