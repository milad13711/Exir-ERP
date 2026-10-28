import { ConflictException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../../generated/tenant-client/index.js';
import { jalaliMonthRange, monthLabel, periodKey, toFaDigits, toJalaliTehran } from './jalali-periods.js';

type Db = Pick<TenantPrismaClient, 'accountingPeriodLock'>;

/** کلید «سال-ماه» جلالی (وقت تهران) برای یک تاریخ. */
export function periodKeyOfDate(date: Date): { key: string; year: number; month: number } {
  const j = toJalaliTehran(date);
  return { key: periodKey(j.year, j.month), year: j.year, month: j.month };
}

/**
 * مرز ایمنی همه‌ی مسیرهای ثبت سند: اگر ماهِ جلالیِ `date` قفل باشد، خطای ۴۰۹ فارسی می‌دهد.
 * تاریخ نامعتبر عبور داده نمی‌شود (سند بدون تاریخ معتبر ساخته نمی‌شود).
 */
export async function assertPeriodOpen(db: Db, date: Date | string | null | undefined): Promise<void> {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) throw new ConflictException('تاریخ سند نامعتبر است');
  const { key, year, month } = periodKeyOfDate(d);
  const lock = await db.accountingPeriodLock.findUnique({ where: { periodKey: key }, select: { isLocked: true } });
  if (lock?.isLocked) {
    throw new ConflictException(`دوره‌ی مالی ${monthLabel(year, month)} بسته شده است؛ ثبت، ویرایش یا ابطال سند با تاریخ این ماه ممکن نیست (برای تغییر، ابتدا قفل ماه را باز کنید).`);
  }
}

export async function assertPeriodsOpen(db: Db, dates: Array<Date | string | null | undefined>): Promise<void> {
  const seen = new Set<string>();
  for (const d of dates) {
    const dd = d instanceof Date ? d : d ? new Date(d) : new Date();
    const k = Number.isNaN(dd.getTime()) ? 'invalid' : periodKeyOfDate(dd).key;
    if (seen.has(k)) continue;
    seen.add(k);
    await assertPeriodOpen(db, dd);
  }
}

export async function lockedKeys(db: Db, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.accountingPeriodLock.findMany({ where: { periodKey: { in: keys }, isLocked: true }, select: { periodKey: true } });
  return new Set(rows.map((r) => r.periodKey));
}

export function describePeriod(year: number, month: number) {
  const { from, toExclusive } = jalaliMonthRange(year, month);
  return { key: periodKey(year, month), label: `${monthLabel(year, month)}`, from, toExclusive, faYear: toFaDigits(year) };
}
