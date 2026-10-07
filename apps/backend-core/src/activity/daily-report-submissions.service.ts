import { Injectable } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { faDate } from '../common/persian.js';

export type SubmissionStatus = 'ON_TIME' | 'LATE' | 'MISSING' | 'PENDING';
export type SubmissionMode = 'MANUAL' | 'AUTO';

export type SubmissionRow = {
  userId: string;
  userName: string;
  /** روز کاری (تاریخ میلادی تهران، yyyy-mm-dd) */
  date: string;
  dateFa: string;
  submitted: boolean;
  /** لحظه‌ی ثبت گزارش (ISO) */
  submittedAt: string | null;
  /** ساعت ثبت به وقت تهران، HH:mm */
  submittedTimeFa: string | null;
  mode: SubmissionMode | null;
  status: SubmissionStatus;
  itemsTotal: number;
  itemsDone: number;
};

export type SubmissionSummary = {
  userId: string;
  userName: string;
  days: number;
  onTime: number;
  late: number;
  missing: number;
  pending: number;
  manual: number;
  auto: number;
  /** میانگین ساعت ثبت دستی (دقیقه از نیمه‌شب تهران) یا null */
  avgManualMinutes: number | null;
};

export type CutoffConfig = { hour: number; minute: number };
export const DEFAULT_CUTOFF: CutoffConfig = { hour: 23, minute: 59 };
export const CUTOFF_SETTING = { moduleCode: 'daily-checklist', key: 'report-cutoff' } as const;
const MAX_RANGE_DAYS = 62;
const TEHRAN_OFFSET = '+03:30';

export function parseCutoff(value: unknown): CutoffConfig {
  const v = value as { hour?: unknown; minute?: unknown } | string | null | undefined;
  if (typeof v === 'string') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return { hour: Number(m[1]), minute: Number(m[2]) };
  } else if (v && typeof v === 'object' && Number.isInteger(v.hour) && Number.isInteger(v.minute)) {
    const h = v.hour as number;
    const mi = v.minute as number;
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return { hour: h, minute: mi };
  }
  return DEFAULT_CUTOFF;
}

/** تاریخ (میلادی) به وقت تهران به‌صورت yyyy-mm-dd */
export function tehranYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function tehranHm(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** آخرین لحظه‌ی «به‌موقع» برای روز کاری ymd: ساعت cutoff همان روز (تا انتهای همان دقیقه). */
export function onTimeDeadline(ymd: string, cutoff: CutoffConfig): Date {
  const hh = String(cutoff.hour).padStart(2, '0');
  const mm = String(cutoff.minute).padStart(2, '0');
  return new Date(`${ymd}T${hh}:${mm}:59.999${TEHRAN_OFFSET}`);
}

export type DayInput = {
  userId: string;
  userName: string;
  ymd: string;
  date: Date;
  itemsTotal: number;
  itemsDone: number;
  reportCreatedAt: Date | null;
  auto: boolean;
};

/** خالص: وضعیت «به‌موقع / با تأخیر / ثبت‌نشده / در انتظار» هر فرد-روز. */
export function buildSubmissionRow(input: DayInput, cutoff: CutoffConfig, now: Date): SubmissionRow {
  const deadline = onTimeDeadline(input.ymd, cutoff);
  let status: SubmissionStatus;
  if (input.reportCreatedAt) {
    // گزارش خودکارِ پایان روز یعنی فرد خودش ثبت نکرده → حتی اگر ساعتش زود باشد «با تأخیر» حساب می‌شود
    status = !input.auto && input.reportCreatedAt.getTime() <= deadline.getTime() ? 'ON_TIME' : 'LATE';
  } else {
    status = now.getTime() <= deadline.getTime() ? 'PENDING' : 'MISSING';
  }
  return {
    userId: input.userId,
    userName: input.userName,
    date: input.ymd,
    dateFa: faDate(input.date),
    submitted: !!input.reportCreatedAt,
    submittedAt: input.reportCreatedAt ? input.reportCreatedAt.toISOString() : null,
    submittedTimeFa: input.reportCreatedAt ? tehranHm(input.reportCreatedAt) : null,
    mode: input.reportCreatedAt ? (input.auto ? 'AUTO' : 'MANUAL') : null,
    status,
    itemsTotal: input.itemsTotal,
    itemsDone: input.itemsDone,
  };
}

export function summarizeSubmissions(rows: SubmissionRow[]): SubmissionSummary[] {
  const map = new Map<string, SubmissionSummary & { _sum: number; _n: number }>();
  for (const r of rows) {
    const s = map.get(r.userId) ?? { userId: r.userId, userName: r.userName, days: 0, onTime: 0, late: 0, missing: 0, pending: 0, manual: 0, auto: 0, avgManualMinutes: null, _sum: 0, _n: 0 };
    s.days += 1;
    if (r.status === 'ON_TIME') s.onTime += 1;
    else if (r.status === 'LATE') s.late += 1;
    else if (r.status === 'MISSING') s.missing += 1;
    else s.pending += 1;
    if (r.mode === 'MANUAL') {
      s.manual += 1;
      const [h, m] = (r.submittedTimeFa ?? '0:0').split(':').map(Number);
      s._sum += h * 60 + m;
      s._n += 1;
    } else if (r.mode === 'AUTO') s.auto += 1;
    map.set(r.userId, s);
  }
  return [...map.values()].map(({ _sum, _n, ...s }) => ({ ...s, avgManualMinutes: _n > 0 ? Math.round(_sum / _n) : null }));
}

@Injectable()
export class DailyReportSubmissionService {
  async getCutoff(db: TenantPrismaClient): Promise<CutoffConfig> {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: CUTOFF_SETTING } });
    return parseCutoff(row?.value);
  }

  async setCutoff(db: TenantPrismaClient, cutoff: CutoffConfig): Promise<CutoffConfig> {
    const value = cutoff as unknown as object;
    await db.moduleSetting.upsert({
      where: { moduleCode_key: CUTOFF_SETTING },
      create: { ...CUTOFF_SETTING, value },
      update: { value },
    });
    return cutoff;
  }

  /** بازه‌ی روزها را به تاریخ‌های تهران نرمال می‌کند (پیش‌فرض ۷ روز اخیر، حداکثر ۶۲ روز). */
  resolveRange(fromParam?: string, toParam?: string, now: Date = new Date()): { from: string; to: string } {
    const toYmd = toParam ? tehranYmd(parseDateParam(toParam) ?? now) : tehranYmd(now);
    let fromYmd = fromParam ? tehranYmd(parseDateParam(fromParam) ?? now) : tehranYmd(new Date(parseYmd(toYmd).getTime() - 6 * 86_400_000));
    if (fromYmd > toYmd) fromYmd = toYmd;
    const minFrom = tehranYmd(new Date(parseYmd(toYmd).getTime() - (MAX_RANGE_DAYS - 1) * 86_400_000));
    if (fromYmd < minFrom) fromYmd = minFrom;
    return { from: fromYmd, to: toYmd };
  }

  /**
   * ساعت دقیق ثبت گزارش روزانه به‌ازای هر فرد و روز: از Report.createdAt (ساعت ثبت اولیه — بعدها که کرون پایان‌روز
   * متن گزارش را به‌روز می‌کند تغییر نمی‌کند)، و DailyChecklistDayClose.auto برای «دستی/خودکار».
   * @param userIds اگر داده شود فقط همین افراد (محدودسازی دسترسی در لایه‌ی بالاتر)
   */
  async compute(db: TenantPrismaClient, opts: { from?: string; to?: string; userIds?: string[]; now?: Date }): Promise<{ range: { from: string; to: string }; cutoff: CutoffConfig; rows: SubmissionRow[]; summary: SubmissionSummary[] }> {
    const now = opts.now ?? new Date();
    const range = this.resolveRange(opts.from, opts.to, now);
    const cutoff = await this.getCutoff(db);
    const gte = parseYmd(range.from);
    const lte = parseYmd(range.to);
    const userFilter = opts.userIds ? { userId: { in: opts.userIds } } : {};

    const [itemGroups, doneGroups, closes] = await Promise.all([
      db.dailyChecklistItem.groupBy({ by: ['userId', 'date'], where: { date: { gte, lte }, ...userFilter }, _count: { _all: true } }),
      db.dailyChecklistItem.groupBy({ by: ['userId', 'date'], where: { date: { gte, lte }, done: true, ...userFilter }, _count: { _all: true } }),
      db.dailyChecklistDayClose.findMany({ where: { date: { gte, lte }, ...userFilter }, select: { userId: true, date: true, reportId: true, auto: true } }),
    ]);

    const reportIds = closes.map((c) => c.reportId).filter((x): x is string => !!x);
    const reports = reportIds.length ? await db.report.findMany({ where: { id: { in: reportIds } }, select: { id: true, createdAt: true } }) : [];
    const reportAt = new Map(reports.map((r) => [r.id, r.createdAt]));

    const key = (userId: string, date: Date) => `${userId}|${date.toISOString().slice(0, 10)}`;
    const totals = new Map(itemGroups.map((g) => [key(g.userId, g.date), g._count._all]));
    const dones = new Map(doneGroups.map((g) => [key(g.userId, g.date), g._count._all]));
    const closeBy = new Map(closes.map((c) => [key(c.userId, c.date), c]));

    // فرد-روزهایی که انتظار گزارش دارند: چک‌لیست داشته‌اند یا گزارش ثبت کرده‌اند
    const keys = new Set<string>([...totals.keys(), ...[...closeBy.entries()].filter(([, c]) => c.reportId).map(([k]) => k)]);
    const userIds = [...new Set([...keys].map((k) => k.split('|')[0]))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));

    const rows: SubmissionRow[] = [...keys].map((k) => {
      const [userId, ymd] = k.split('|');
      const close = closeBy.get(k);
      const createdAt = close?.reportId ? (reportAt.get(close.reportId) ?? null) : null;
      return buildSubmissionRow(
        { userId, userName: names.get(userId) ?? '—', ymd, date: parseYmd(ymd), itemsTotal: totals.get(k) ?? 0, itemsDone: dones.get(k) ?? 0, reportCreatedAt: createdAt, auto: close?.auto === true },
        cutoff,
        now,
      );
    });
    rows.sort((a, b) => (a.date === b.date ? a.userName.localeCompare(b.userName, 'fa') : a.date < b.date ? 1 : -1));
    return { range, cutoff, rows, summary: summarizeSubmissions(rows).sort((a, b) => a.userName.localeCompare(b.userName, 'fa')) };
  }
}

function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function parseDateParam(v: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00${TEHRAN_OFFSET}`);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
