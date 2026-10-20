import { toJalaliDate } from '../common/jalali.js';

const TEHRAN_OFFSET_MS = 3.5 * 3600_000;

/** تاریخ شمسی بر پایه‌ی ساعت تهران (مستقل از منطقه‌ی زمانی سرور). */
export function tehranJalali(date: Date): { year: number; month: number; day: number } {
  const t = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  return toJalaliDate(new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

/** شروع روز تهران (UTC instant) برای رشته‌ی YYYY-MM-DD میلادی؛ نامعتبر → null. */
export function tehranDayStart(ymd: string | undefined | null): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00+03:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** پایان (انحصاری) روز تهران = شروع روز بعد. */
export function tehranDayEnd(ymd: string | undefined | null): Date | null {
  const s = tehranDayStart(ymd);
  return s ? new Date(s.getTime() + 24 * 3600_000) : null;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** «۱۴۰۵/۰۷/۱۲» به‌صورت لاتین 1405/07/12 (برای متن PDF/CSV؛ رندر ارقام فارسی با فراخواننده). */
export function jalaliText(date: Date): string {
  const j = tehranJalali(date);
  return `${j.year}/${pad2(j.month)}/${pad2(j.day)}`;
}

export function jalaliTimeText(date: Date): string {
  const t = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  return `${jalaliText(date)} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}
