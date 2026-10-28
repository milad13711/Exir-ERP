import { BadRequestException } from '@nestjs/common';
import { fromTehran, tehranParts } from '../../booking/tehran-time.js';
import { JALALI_MONTHS, jalaliMonthLength, toGregorian, toJalaliDate } from '../../common/jalali.js';

/**
 * مدل دوره‌ی مالی جلالی — همه‌ی مرزها «اولین لحظه‌ی روز ۱ ماه جلالی به وقت تهران» هستند و به لحظه‌ی مطلق (UTC) تبدیل
 * می‌شوند؛ بازه همیشه [from, toExclusive) است تا هیچ سندی هم در دو ماه شمرده نشود و هم از قلم نیفتد.
 *
 * سال مالی با «سال جلالیِ ماه شروع» نام‌گذاری می‌شود: با شروع فروردین، سال مالی ۱۴۰۵ = فروردین تا اسفند ۱۴۰۵؛
 * با شروع مهر، سال مالی ۱۴۰۵ = مهر ۱۴۰۵ تا شهریور ۱۴۰۶.
 */

export const DEFAULT_FISCAL_START_MONTH = 1;
const EPOCH = new Date(0);
const FAR_FUTURE = new Date('2200-01-01T00:00:00Z');

export type JalaliYm = { year: number; month: number };
export type PeriodRange = { from: Date; toExclusive: Date };

export type ResolvedPeriod = PeriodRange & {
  mode: 'month' | 'fiscal' | 'custom' | 'all';
  /** «1405-07» فقط وقتی mode=month */
  key: string | null;
  label: string;
  /** سال مالیِ شامل `from` (برای محاسبه‌ی مانده‌ی ابتدای سال مالی) */
  fiscalYear: number;
  fiscalYearStart: Date;
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function toFaDigits(v: string | number): string {
  return String(v).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function periodKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

export function parsePeriodKey(key: string): JalaliYm {
  const m = /^(\d{4})-(\d{1,2})$/.exec((key ?? '').trim());
  if (!m) throw new BadRequestException('قالب دوره نامعتبر است (نمونه: 1405-07)');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1300 || year > 1600 || month < 1 || month > 12) throw new BadRequestException('دوره‌ی مالی نامعتبر است');
  return { year, month };
}

export function monthLabel(year: number, month: number): string {
  return `${JALALI_MONTHS[month - 1]} ${toFaDigits(year)}`;
}

/** تاریخ میلادیِ «روز جلالی» به‌صورت کلید YYYY-MM-DD (بدون وابستگی به منطقه‌ی زمانی سرور). */
function gregorianKeyOfJalali(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd); // Date محلی با اجزای میلادی درست
  return `${g.getFullYear()}-${pad2(g.getMonth() + 1)}-${pad2(g.getDate())}`;
}

/** لحظه‌ی مطلق نیمه‌شبِ تهرانِ یک روز جلالی. */
export function jalaliDayStart(jy: number, jm: number, jd: number): Date {
  return fromTehran(gregorianKeyOfJalali(jy, jm, jd), 0);
}

/** تاریخ جلالی (به وقت تهران) یک لحظه‌ی مطلق. */
export function toJalaliTehran(date: Date): { year: number; month: number; day: number } {
  const [y, m, d] = tehranParts(date).dateKey.split('-').map(Number);
  return toJalaliDate(new Date(y, m - 1, d));
}

export function jalaliMonthRange(year: number, month: number): PeriodRange {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { from: jalaliDayStart(year, month, 1), toExclusive: jalaliDayStart(nextYear, nextMonth, 1) };
}

export function normalizeStartMonth(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : DEFAULT_FISCAL_START_MONTH;
}

/** سال مالیِ شامل یک لحظه. */
export function fiscalYearOf(date: Date, startMonth: number): number {
  const j = toJalaliTehran(date);
  return j.month >= startMonth ? j.year : j.year - 1;
}

export function fiscalYearRange(fiscalYear: number, startMonth: number): PeriodRange {
  return {
    from: jalaliMonthRange(fiscalYear, startMonth).from,
    toExclusive: jalaliMonthRange(fiscalYear + 1, startMonth).from,
  };
}

/** ۱۲ ماه سال مالی به ترتیب. */
export function fiscalYearMonths(fiscalYear: number, startMonth: number): Array<JalaliYm & PeriodRange & { key: string; label: string; days: number }> {
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const idx = startMonth - 1 + i;
    const month = (idx % 12) + 1;
    const year = fiscalYear + Math.floor(idx / 12);
    out.push({ year, month, key: periodKey(year, month), label: monthLabel(year, month), days: jalaliMonthLength(year, month), ...jalaliMonthRange(year, month) });
  }
  return out;
}

/** n ماه منتهی به (و شامل) یک ماه، از قدیم به جدید. */
export function monthsEndingAt(end: JalaliYm, count: number): JalaliYm[] {
  const out: JalaliYm[] = [];
  let { year, month } = end;
  for (let i = 0; i < count; i += 1) {
    out.unshift({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

export function shiftMonth(ym: JalaliYm, delta: number): JalaliYm {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function currentJalaliMonth(now: Date = new Date()): JalaliYm {
  const j = toJalaliTehran(now);
  return { year: j.year, month: j.month };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `from`/`to` سفارشی: فقط‌تاریخ = ابتدا/انتهای روز تهران (to شامل همان روز)؛ ISO کامل = همان لحظه. */
function parseBoundary(raw: string, kind: 'from' | 'to'): Date {
  if (DATE_ONLY.test(raw)) {
    const start = fromTehran(raw, 0);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    return kind === 'from' ? start : new Date(start.getTime() + 86_400_000);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
  return kind === 'from' ? d : new Date(d.getTime() + 1);
}

export type PeriodQuery = { period?: string; fiscalYear?: string; from?: string; to?: string; asOf?: string };

/**
 * اولویت: from/to سفارشی ← period=YYYY-MM ← period=all ← fiscalYear=YYYY ← (پیش‌فرض) ماه جاری جلالی.
 * `defaultMode='all'` برای گزارش‌هایی که پیش‌فرض‌شان تجمیعی است (مثل دفتر حساب).
 */
export function resolvePeriod(
  q: PeriodQuery,
  opts: { startMonth?: number; now?: Date; defaultMode?: 'month' | 'all' } = {},
): ResolvedPeriod {
  const startMonth = normalizeStartMonth(opts.startMonth);
  const now = opts.now ?? new Date();

  const finish = (mode: ResolvedPeriod['mode'], range: PeriodRange, key: string | null, label: string): ResolvedPeriod => {
    if (!(range.from.getTime() < range.toExclusive.getTime())) throw new BadRequestException('بازه‌ی زمانی نامعتبر است (شروع باید پیش از پایان باشد)');
    const fiscalYear = fiscalYearOf(mode === 'all' ? now : range.from, startMonth);
    const fiscalYearStart = mode === 'all' ? EPOCH : fiscalYearRange(fiscalYear, startMonth).from;
    return { mode, ...range, key, label, fiscalYear, fiscalYearStart };
  };

  if (q.from || q.to) {
    const from = q.from ? parseBoundary(q.from, 'from') : EPOCH;
    const toExclusive = q.to ? parseBoundary(q.to, 'to') : FAR_FUTURE;
    return finish('custom', { from, toExclusive }, null, 'بازه‌ی دلخواه');
  }
  if (q.period && q.period !== 'all') {
    const { year, month } = parsePeriodKey(q.period);
    return finish('month', jalaliMonthRange(year, month), periodKey(year, month), monthLabel(year, month));
  }
  if (q.period === 'all') return finish('all', { from: EPOCH, toExclusive: FAR_FUTURE }, null, 'کل دوره (تجمیعی)');
  if (q.fiscalYear) {
    const fy = Number(q.fiscalYear);
    if (!Number.isInteger(fy) || fy < 1300 || fy > 1600) throw new BadRequestException('سال مالی نامعتبر است');
    return finish('fiscal', fiscalYearRange(fy, startMonth), null, `سال مالی ${toFaDigits(fy)}`);
  }
  if (opts.defaultMode === 'all') return finish('all', { from: EPOCH, toExclusive: FAR_FUTURE }, null, 'کل دوره (تجمیعی)');
  const cur = currentJalaliMonth(now);
  return finish('month', jalaliMonthRange(cur.year, cur.month), periodKey(cur.year, cur.month), monthLabel(cur.year, cur.month));
}

/** تاریخ «تا» برای ترازنامه: asOf صریح ← انتهای دوره (حداکثر الان نیست؛ همان انتهای دوره) ← الان. */
export function resolveAsOf(q: PeriodQuery, opts: { startMonth?: number; now?: Date } = {}): { asOfExclusive: Date; label: string } {
  const now = opts.now ?? new Date();
  if (q.asOf) {
    const d = parseBoundary(q.asOf, 'to');
    return { asOfExclusive: d, label: q.asOf };
  }
  if (q.period || q.fiscalYear || q.from || q.to) {
    const p = resolvePeriod(q, opts);
    const end = p.mode === 'all' || p.toExclusive.getTime() > FAR_FUTURE.getTime() - 1 ? new Date(now.getTime() + 1) : p.toExclusive;
    return { asOfExclusive: end, label: p.label };
  }
  return { asOfExclusive: new Date(now.getTime() + 1), label: 'اکنون' };
}

export function isFarFuture(d: Date): boolean {
  return d.getTime() >= FAR_FUTURE.getTime();
}
