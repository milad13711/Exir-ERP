/**
 * منطق خالصِ تجمیع داشبورد عملیات (بدون دیتابیس) — تا هم سرویس و هم تست‌ها از یک منبع استفاده کنند.
 * همه‌ی «روزها» بر اساس تقویم تهران (UTC+03:30) و هفته از شنبه شروع می‌شود.
 */
import { ACTIVE_STATUSES, FINISHED_STATUSES, type TaskStatusValue } from '../tasks/task-state.js';

const TEHRAN_OFFSET_MS = 210 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ── زمان ────────────────────────────────────────────────────────────────

export function startOfTehranDay(now: Date): Date {
  return new Date(Math.floor((now.getTime() + TEHRAN_OFFSET_MS) / DAY_MS) * DAY_MS - TEHRAN_OFFSET_MS);
}

/** شروع هفته‌ی ایرانی (شنبه، نیمه‌شب تهران). */
export function startOfTehranWeek(now: Date): Date {
  const dayStart = startOfTehranDay(now);
  const days = Math.floor((dayStart.getTime() + TEHRAN_OFFSET_MS) / DAY_MS); // روزهای از epoch؛ epoch = پنجشنبه
  const dow = (days + 4) % 7; // 0 = یکشنبه … 6 = شنبه
  const sinceSaturday = (dow + 1) % 7;
  return new Date(dayStart.getTime() - sinceSaturday * DAY_MS);
}

/** کلید روز تهران به‌صورت YYYY-MM-DD (میلادی؛ فرانت به جلالی نمایش می‌دهد). */
export function tehranDayKey(d: Date): string {
  return new Date(d.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

export type DateRange = { from: Date; to: Date };

export function parseRange(fromRaw: string | undefined, toRaw: string | undefined, now: Date, defaultDays = 30): DateRange {
  const toParsed = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw) : null;
  const fromParsed = fromRaw && !Number.isNaN(Date.parse(fromRaw)) ? new Date(fromRaw) : null;
  const to = toParsed ?? now;
  let from = fromParsed ?? new Date(to.getTime() - defaultDays * DAY_MS);
  if (from.getTime() > to.getTime()) from = new Date(to.getTime() - defaultDays * DAY_MS);
  // سقف یک‌ساله تا کوئری‌ها کنترل‌شده بمانند
  const max = 366 * DAY_MS;
  if (to.getTime() - from.getTime() > max) from = new Date(to.getTime() - max);
  return { from, to };
}

export function clampDays(raw: unknown, def = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.max(Math.floor(n), 7), 90);
}

// ── شمارنده‌ها ────────────────────────────────────────────────────────────

export type StatusCounts = Partial<Record<TaskStatusValue, number>>;

export type OverviewCounters = {
  new: number;
  seenNotStarted: number;
  inProgress: number;
  overdue: number;
  awaitingApproval: number;
  returnedForFix: number;
  hasProblem: number;
  extensionPending: number;
  scheduled: number;
};

/** شمارنده‌های لحظه‌ای از groupBy وضعیت (منتشرشده‌ها) + مقادیر جدا. */
export function counterFromStatuses(byStatus: StatusCounts, extra: { overdue: number; extensionPending: number; scheduled: number }): OverviewCounters {
  const c = (s: TaskStatusValue) => byStatus[s] ?? 0;
  return {
    new: c('NEW') + c('OPEN'),
    seenNotStarted: c('SEEN'),
    inProgress: c('IN_PROGRESS'),
    overdue: extra.overdue,
    awaitingApproval: c('DONE'),
    returnedForFix: c('RETURNED_FOR_FIX'),
    hasProblem: c('HAS_PROBLEM'),
    extensionPending: extra.extensionPending,
    scheduled: extra.scheduled,
  };
}

export type FinishedRow = { createdAt: Date; completedAt: Date | null; dueAt: Date | null };

export type RangeStats = {
  created: number;
  completed: number;
  completionRate: number | null; // ۰..۱
  avgCompletionHours: number | null;
  onTimeRate: number | null; // ۰..۱
};

/** آمار بازه: ایجادشده، انجام‌شده، نرخ تکمیل، میانگین زمان تا انجام و نرخ به‌موقع. */
export function computeRangeStats(createdCount: number, finishedInRange: FinishedRow[]): RangeStats {
  const done = finishedInRange.filter((r) => r.completedAt);
  let sumMs = 0;
  let timed = 0;
  let onTime = 0;
  let withDue = 0;
  for (const r of done) {
    const diff = r.completedAt!.getTime() - r.createdAt.getTime();
    if (diff >= 0) {
      sumMs += diff;
      timed += 1;
    }
    if (r.dueAt) {
      withDue += 1;
      if (r.completedAt!.getTime() <= r.dueAt.getTime()) onTime += 1;
    }
  }
  return {
    created: createdCount,
    completed: done.length,
    completionRate: createdCount > 0 ? Math.min(1, done.length / createdCount) : null,
    avgCompletionHours: timed > 0 ? round1(sumMs / timed / HOUR_MS) : null,
    onTimeRate: withDue > 0 ? round3(onTime / withDue) : null,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ── بار کاری افراد ───────────────────────────────────────────────────────

export type WorkloadTask = {
  status: TaskStatusValue;
  dueAt: Date | null;
  isPublished: boolean;
  createdAt: Date;
  completedAt: Date | null;
  assigneeIds: string[];
};

export type WorkloadChip = 'overloaded' | 'has_overdue' | 'idle' | 'ok';

export type WorkloadRow = {
  userId: string;
  openCount: number;
  overdueCount: number;
  awaitingApprovalCount: number;
  doneInRange: number;
  avgCompletionHours: number | null;
  lastActivityAt: Date | null;
  chips: WorkloadChip[];
};

export const OVERLOAD_THRESHOLD = 8;

export function workloadChips(r: Pick<WorkloadRow, 'openCount' | 'overdueCount'>): WorkloadChip[] {
  const chips: WorkloadChip[] = [];
  if (r.overdueCount > 0) chips.push('has_overdue');
  if (r.openCount >= OVERLOAD_THRESHOLD) chips.push('overloaded');
  if (r.openCount === 0) chips.push('idle');
  if (chips.length === 0) chips.push('ok');
  return chips;
}

/**
 * بار کاری هر ارجاع‌گیرنده. وظیفه‌ی چندنفره برای هر نفر جداگانه شمرده می‌شود.
 * `onlyUserId`: برای غیرمدیر فقط ردیف خودش برمی‌گردد.
 */
export function computeWorkload(
  tasks: WorkloadTask[],
  range: DateRange,
  now: Date,
  lastActivity: Map<string, Date>,
  onlyUserId?: string | null,
): WorkloadRow[] {
  type Acc = { open: number; overdue: number; awaiting: number; done: number; sumMs: number; timed: number };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { open: 0, overdue: 0, awaiting: 0, done: 0, sumMs: 0, timed: 0 }));
    return a;
  };
  for (const t of tasks) {
    const ids = onlyUserId ? t.assigneeIds.filter((i) => i === onlyUserId) : t.assigneeIds;
    for (const id of ids) {
      const a = get(id);
      if (ACTIVE_STATUSES.includes(t.status)) {
        a.open += 1;
        if (t.isPublished && t.dueAt && t.dueAt.getTime() < now.getTime()) a.overdue += 1;
      }
      if (t.status === 'DONE') a.awaiting += 1;
      if (FINISHED_STATUSES.includes(t.status) && t.completedAt && t.completedAt >= range.from && t.completedAt <= range.to) {
        a.done += 1;
        const diff = t.completedAt.getTime() - t.createdAt.getTime();
        if (diff >= 0) {
          a.sumMs += diff;
          a.timed += 1;
        }
      }
    }
  }
  if (onlyUserId && !acc.has(onlyUserId)) get(onlyUserId);
  return [...acc.entries()].map(([userId, a]) => {
    const base = {
      userId,
      openCount: a.open,
      overdueCount: a.overdue,
      awaitingApprovalCount: a.awaiting,
      doneInRange: a.done,
      avgCompletionHours: a.timed > 0 ? round1(a.sumMs / a.timed / HOUR_MS) : null,
      lastActivityAt: lastActivity.get(userId) ?? null,
    };
    return { ...base, chips: workloadChips(base) };
  });
}

export type WorkloadSort = 'open' | 'overdue' | 'done' | 'avg' | 'last' | 'name';

export function sortWorkload<T extends WorkloadRow & { name?: string }>(rows: T[], sort: WorkloadSort, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const key = (r: T): number | string => {
    switch (sort) {
      case 'overdue':
        return r.overdueCount;
      case 'done':
        return r.doneInRange;
      case 'avg':
        return r.avgCompletionHours ?? Number.POSITIVE_INFINITY;
      case 'last':
        return r.lastActivityAt ? r.lastActivityAt.getTime() : 0;
      case 'name':
        return r.name ?? '';
      default:
        return r.openCount;
    }
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === 'string' ? ka.localeCompare(kb as string, 'fa') : ka === kb ? 0 : ka < (kb as number) ? -1 : 1;
    return c * sign || a.userId.localeCompare(b.userId);
  });
}

// ── نیازمند اقدام ────────────────────────────────────────────────────────

export type AttentionKind = 'problem' | 'extension' | 'approval' | 'overdue' | 'unseen' | 'scheduled';
export type Priority = 'NORMAL' | 'MEDIUM' | 'URGENT';

export type AttentionDraft = {
  kind: AttentionKind;
  taskId: string;
  /** برای درخواست تمدید */
  extensionRequestId?: string | null;
  /** «از چه زمانی منتظر است» */
  since: Date;
  priority: Priority;
};

const KIND_BASE: Record<AttentionKind, number> = { problem: 80, overdue: 70, extension: 60, approval: 50, unseen: 30, scheduled: 10 };
const PRIORITY_BONUS: Record<Priority, number> = { URGENT: 20, MEDIUM: 8, NORMAL: 0 };

/** امتیاز اولویت: نوع مورد + فوریت وظیفه + مدت انتظار (سقف ۴۸ امتیاز). */
export function attentionScore(d: AttentionDraft, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - d.since.getTime()) / HOUR_MS);
  return KIND_BASE[d.kind] + PRIORITY_BONUS[d.priority] + Math.min(48, Math.floor(ageHours));
}

export function rankAttention<T extends AttentionDraft>(items: T[], now: Date, limit = 100): Array<T & { score: number; ageHours: number }> {
  return items
    .map((i) => ({ ...i, score: attentionScore(i, now), ageHours: Math.max(0, Math.floor((now.getTime() - i.since.getTime()) / HOUR_MS)) }))
    .sort((a, b) => b.score - a.score || a.since.getTime() - b.since.getTime() || a.taskId.localeCompare(b.taskId))
    .slice(0, limit);
}

// ── روند ────────────────────────────────────────────────────────────────

export type TrendTask = { createdAt: Date; completedAt: Date | null; priority: Priority; status: TaskStatusValue };

export type TrendResult = {
  series: Array<{ date: string; created: number; completed: number }>;
  byPriority: Record<Priority, { created: number; completed: number }>;
};

/** سری روزانه‌ی «ایجادشده در برابر انجام‌شده» برای `days` روز منتهی به امروز (تهران) + تفکیک اولویت. */
export function buildTrend(tasks: TrendTask[], days: number, now: Date): TrendResult {
  const today = startOfTehranDay(now);
  const first = new Date(today.getTime() - (days - 1) * DAY_MS);
  const index = new Map<string, number>();
  const series: TrendResult['series'] = [];
  for (let i = 0; i < days; i++) {
    const key = tehranDayKey(new Date(first.getTime() + i * DAY_MS + 12 * HOUR_MS));
    index.set(key, i);
    series.push({ date: key, created: 0, completed: 0 });
  }
  const byPriority: TrendResult['byPriority'] = {
    NORMAL: { created: 0, completed: 0 },
    MEDIUM: { created: 0, completed: 0 },
    URGENT: { created: 0, completed: 0 },
  };
  for (const t of tasks) {
    const ci = index.get(tehranDayKey(t.createdAt));
    if (ci !== undefined) {
      series[ci].created += 1;
      byPriority[t.priority].created += 1;
    }
    if (t.completedAt && FINISHED_STATUSES.includes(t.status)) {
      const di = index.get(tehranDayKey(t.completedAt));
      if (di !== undefined) {
        series[di].completed += 1;
        byPriority[t.priority].completed += 1;
      }
    }
  }
  return { series, byPriority };
}

// ── فید فعالیت ───────────────────────────────────────────────────────────

export const EVENT_LABELS: Record<string, string> = {
  created: 'وظیفه را ایجاد کرد',
  scheduled: 'ارسال وظیفه را زمان‌بندی کرد',
  sent: 'وظیفه را ارسال کرد',
  viewed: 'وظیفه را دید',
  seen: 'وظیفه را دید',
  started: 'کار را شروع کرد',
  result_submitted: 'نتیجه را ثبت کرد',
  auto_approved: 'تأیید خودکار شد',
  approved: 'وظیفه را تأیید کرد',
  returned: 'وظیفه را برای اصلاح برگرداند',
  problem_reported: 'مشکل گزارش کرد',
  problem_resolved: 'مشکل را برطرف کرد',
  extension_requested: 'درخواست تمدید داد',
  extension_approved: 'تمدید را تأیید کرد',
  extension_rejected: 'تمدید را رد کرد',
  deadline_changed: 'موعد را تغییر داد',
  edited: 'وظیفه را ویرایش کرد',
  reassigned: 'وظیفه را ارجاع مجدد کرد',
  cancelled: 'وظیفه را لغو کرد',
  reopened: 'وظیفه را بازگشایی کرد',
  expired: 'وظیفه منقضی شد',
  resumed: 'وظیفه از انقضا برگشت',
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function decodeCursor(raw: string | undefined): string | undefined {
  return raw && /^[0-9a-fA-F-]{36}$/.test(raw) ? raw : undefined;
}

export function clampLimit(raw: unknown, def = 30, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

// ── CSV ─────────────────────────────────────────────────────────────────

const STATUS_FA: Record<string, string> = {
  OPEN: 'جدید',
  NEW: 'جدید',
  SEEN: 'دیده‌شده',
  IN_PROGRESS: 'در حال انجام',
  DONE: 'منتظر تأیید',
  APPROVED: 'تأییدشده',
  HAS_PROBLEM: 'دارای مشکل',
  RETURNED_FOR_FIX: 'بازگشت برای اصلاح',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغوشده',
};
const PRIORITY_FA: Record<string, string> = { NORMAL: 'عادی', MEDIUM: 'متوسط', URGENT: 'فوری' };

export const statusFa = (s: string) => STATUS_FA[s] ?? s;
export const priorityFa = (p: string) => PRIORITY_FA[p] ?? p;

/** خنثی‌سازی فرمول‌های اکسل (CSV injection) و نقل‌قول‌گذاری استاندارد. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tehranDateTime(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d.getTime() + TEHRAN_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16);
}

export const CSV_HEADER = ['شماره', 'عنوان', 'وضعیت', 'اولویت', 'ارجاع‌گیرندگان', 'سازنده', 'تاریخ ایجاد', 'موعد', 'تاریخ انجام', 'ساعت تا انجام', 'دارای تأخیر'];

export type CsvTask = {
  code: string;
  title: string;
  status: string;
  priority: string;
  assignees: string[];
  creator: string | null;
  createdAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
};

export function buildCsv(rows: CsvTask[], now: Date): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    const hours = r.completedAt ? round1(Math.max(0, r.completedAt.getTime() - r.createdAt.getTime()) / HOUR_MS) : '';
    const late = r.dueAt
      ? (r.completedAt ? r.completedAt.getTime() > r.dueAt.getTime() : ACTIVE_STATUSES.includes(r.status as TaskStatusValue) && r.dueAt.getTime() < now.getTime())
      : false;
    lines.push(
      [
        r.code,
        r.title,
        statusFa(r.status),
        priorityFa(r.priority),
        r.assignees.join('، '),
        r.creator ?? '',
        tehranDateTime(r.createdAt),
        tehranDateTime(r.dueAt),
        tehranDateTime(r.completedAt),
        hours,
        late ? 'بله' : 'خیر',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
