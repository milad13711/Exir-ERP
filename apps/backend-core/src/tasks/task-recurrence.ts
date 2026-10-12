import { jalaliMonthLength, toGregorian, toJalaliDate } from '../common/jalali.js';

export type RecurrenceType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
const DAY_MS = 86_400_000;

/**
 * تاریخ نمونه‌ی بعدی یک وظیفه‌ی تکرارشونده. ماهانه بر اساس ماه شمسی است (روز ۳۱ در ماه ۳۰روزه به آخر ماه می‌رود)
 * و ساعتِ روز حفظ می‌شود. interval حداقل ۱.
 */
export function nextOccurrence(from: Date, type: RecurrenceType, interval = 1): Date | null {
  const n = Math.max(1, Math.floor(interval) || 1);
  if (type === 'NONE') return null;
  if (type === 'DAILY') return new Date(from.getTime() + n * DAY_MS);
  if (type === 'WEEKLY') return new Date(from.getTime() + n * 7 * DAY_MS);
  const j = toJalaliDate(from);
  const total = j.month - 1 + n;
  const year = j.year + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(j.day, jalaliMonthLength(year, month));
  const diff = toGregorian(year, month, day).getTime() - toGregorian(j.year, j.month, j.day).getTime();
  return new Date(from.getTime() + diff);
}

/** کپیِ فاصله‌ی زمانی: موعد و شروع نمونه‌ی بعدی به همان اندازه جابه‌جا می‌شوند. */
export function shiftDates(
  base: { startAt: Date | null; dueAt: Date | null },
  anchor: Date,
  nextAnchor: Date,
): { startAt: Date | null; dueAt: Date | null } {
  const delta = nextAnchor.getTime() - anchor.getTime();
  return {
    startAt: base.startAt ? new Date(base.startAt.getTime() + delta) : null,
    dueAt: base.dueAt ? new Date(base.dueAt.getTime() + delta) : null,
  };
}
