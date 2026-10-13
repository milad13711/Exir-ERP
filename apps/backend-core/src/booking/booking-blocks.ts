import { fromTehran, tehranParts } from './tehran-time.js';

/** منبع مسدودشدن یک بازه: دستی، یا خودکار از ماژول‌های دیگر. */
export type BlockSource = 'manual' | 'task' | 'calendar' | 'leave';

/** یک بازه‌ی مشغول مطلق (لحظه‌ای) برای یک کاربر؛ reason فقط برای نمایش داخلی است و هرگز به صفحه‌ی عمومی نمی‌رسد. */
export type BusyRange = { userId: string; start: Date; end: Date; source: BlockSource; reason: string };

export type ManualBlockRow = {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD به وقت تهران
  endDate: string;
  startMinute: number | null;
  endMinute: number | null;
  weekdays: number[];
  reason: string | null;
};

export type BlockPreferences = { blockFromTasks: boolean; blockFromCalendar: boolean; blockFromLeave: boolean };
export const DEFAULT_BLOCK_PREFERENCES: BlockPreferences = { blockFromTasks: true, blockFromCalendar: true, blockFromLeave: true };

export const TASK_ACTIVE_STATUSES = ['NEW', 'SEEN', 'IN_PROGRESS', 'RETURNED_FOR_FIX', 'HAS_PROBLEM'] as const;
/** وظیفه‌ای که بازه‌اش بیشتر از این باشد «جلسه‌مانند» نیست (پروژه‌ی چندروزه است) و مسدود نمی‌کند. */
export const MAX_TASK_BLOCK_HOURS = 12;

const DAY_MS = 24 * 3_600_000;

/** دو بازه‌ی نیم‌باز [start, end) هم‌پوشانی دارند؟ */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/** کلید تاریخ بعدی/قبلی، با محاسبه‌ی خالص روی تقویم (مستقل از منطقه‌ی زمانی سرور). */
export function addDaysToKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOfKey(dateKey: string): number {
  return tehranParts(fromTehran(dateKey, 12 * 60)).weekday;
}

/** آغاز روز تهرانیِ dateKey و آغاز روز بعد (برای بازه‌ی تمام‌روز؛ ساعت ۲۴:۰۰ در fromTehran معتبر نیست). */
export function tehranDayBounds(dateKey: string): { start: Date; end: Date } {
  const start = fromTehran(dateKey, 0);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** این بلوک دستی در روز dateKey فعال است؟ (بازه‌ی تاریخ + فیلتر روز هفته) */
export function manualBlockAppliesOnDate(block: Pick<ManualBlockRow, 'startDate' | 'endDate' | 'weekdays'>, dateKey: string): boolean {
  if (dateKey < block.startDate || dateKey > block.endDate) return false;
  if (block.weekdays.length === 0) return true;
  return block.weekdays.includes(weekdayOfKey(dateKey));
}

/** بلوک دستی را برای روزهای [fromKey..toKey] به بازه‌های مطلق باز می‌کند. هر دو سر شامل‌اند. */
export function expandManualBlock(block: ManualBlockRow, fromKey: string, toKey: string): BusyRange[] {
  const out: BusyRange[] = [];
  let key = block.startDate > fromKey ? block.startDate : fromKey;
  const last = block.endDate < toKey ? block.endDate : toKey;
  const reason = block.reason?.trim() ? `ساعت غیرفعال دستی: ${block.reason.trim()}` : 'ساعت غیرفعال دستی';
  for (let i = 0; key <= last && i < 400; i++, key = addDaysToKey(key, 1)) {
    if (!manualBlockAppliesOnDate(block, key)) continue;
    const allDay = block.startMinute == null || block.endMinute == null;
    if (allDay) {
      const { start, end } = tehranDayBounds(key);
      out.push({ userId: block.userId, start, end, source: 'manual', reason });
    } else {
      out.push({ userId: block.userId, start: fromTehran(key, block.startMinute!), end: fromTehran(key, block.endMinute!), source: 'manual', reason });
    }
  }
  return out;
}

export function formatTaskNumber(n: number): string {
  return `TASK-${String(n).padStart(6, '0')}`;
}

/** وظیفه → بازه‌ی مسدود؛ فقط وقتی فعال، منتشرشده، دارای startAt و dueAt و بازه ≤ ۱۲ ساعت باشد. */
export function taskToBusyRange(
  task: { number: number; status: string; isPublished: boolean; startAt: Date | null; dueAt: Date | null },
  userId: string,
): BusyRange | null {
  if (!(TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status)) return null;
  if (!task.isPublished || !task.startAt || !task.dueAt) return null;
  const span = task.dueAt.getTime() - task.startAt.getTime();
  if (span <= 0 || span > MAX_TASK_BLOCK_HOURS * 3_600_000) return null;
  return { userId, start: task.startAt, end: task.dueAt, source: 'task', reason: `به‌دلیل وظیفه ${formatTaskNumber(task.number)}` };
}

/** جلسه‌ی مشاوره/منتورینگ (برنامه‌ریزی‌شده) → بازه‌ی مسدود برای مشاور. */
export function mentoringSessionToBusyRange(
  s: { status: string; scheduledAt: Date; durationMinutes: number; engagementTitle?: string | null },
  advisorUserId: string,
): BusyRange | null {
  if (s.status !== 'SCHEDULED' || s.durationMinutes <= 0) return null;
  const end = new Date(s.scheduledAt.getTime() + s.durationMinutes * 60_000);
  const title = s.engagementTitle?.trim();
  return { userId: advisorUserId, start: s.scheduledAt, end, source: 'calendar', reason: title ? `به‌دلیل جلسه‌ی مشاوره «${title}»` : 'به‌دلیل جلسه‌ی مشاوره' };
}

/** مرخصی تأییدشده → بلوک تمام‌روز از اول روز شروع تا پایان روز پایان (به وقت تهران). */
export function leaveToBusyRange(l: { status: string; startDate: Date; endDate: Date }, userId: string): BusyRange | null {
  if (l.status !== 'APPROVED') return null;
  const startKey = tehranParts(l.startDate).dateKey;
  const endKey = tehranParts(l.endDate).dateKey;
  if (endKey < startKey) return null;
  return { userId, start: tehranDayBounds(startKey).start, end: tehranDayBounds(endKey).end, source: 'leave', reason: 'به‌دلیل مرخصی تأییدشده' };
}

/** بازه‌های مشغول را بر اساس تنظیمات کارشناس فیلتر می‌کند (دستی همیشه اعمال می‌شود). */
export function applyPreferences(ranges: BusyRange[], prefsByUser: Map<string, BlockPreferences>): BusyRange[] {
  return ranges.filter((r) => {
    if (r.source === 'manual') return true;
    const p = prefsByUser.get(r.userId) ?? DEFAULT_BLOCK_PREFERENCES;
    if (r.source === 'task') return p.blockFromTasks;
    if (r.source === 'calendar') return p.blockFromCalendar;
    return p.blockFromLeave;
  });
}

/** آیا [start,end) با هیچ‌کدام از بازه‌ها تداخل دارد؟ */
export function isBlocked(ranges: Array<{ start: Date; end: Date }>, start: Date, end: Date): boolean {
  return ranges.some((r) => overlaps(r.start, r.end, start, end));
}

/** اعتبارسنجی خالص یک بلوک دستی؛ پیام فارسی یا null. */
export const MAX_BLOCK_RANGE_DAYS = 366;
export function validateManualBlockInput(b: { startDate: string; endDate: string; startMinute?: number | null; endMinute?: number | null; weekdays?: number[]; reason?: string | null }): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(b.startDate) || !re.test(b.endDate) || Number.isNaN(Date.parse(`${b.startDate}T00:00:00Z`)) || Number.isNaN(Date.parse(`${b.endDate}T00:00:00Z`))) return 'تاریخ نامعتبر است';
  if (b.endDate < b.startDate) return 'تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد';
  const days = (Date.parse(`${b.endDate}T00:00:00Z`) - Date.parse(`${b.startDate}T00:00:00Z`)) / DAY_MS + 1;
  if (days > MAX_BLOCK_RANGE_DAYS) return `بازه‌ی تاریخ حداکثر ${MAX_BLOCK_RANGE_DAYS} روز می‌تواند باشد`;
  const hasStart = b.startMinute != null;
  const hasEnd = b.endMinute != null;
  if (hasStart !== hasEnd) return 'ساعت شروع و پایان را هر دو مشخص کنید یا هیچ‌کدام (تمام روز)';
  if (hasStart && hasEnd) {
    if (!Number.isInteger(b.startMinute) || !Number.isInteger(b.endMinute) || b.startMinute! < 0 || b.endMinute! > 24 * 60) return 'ساعت نامعتبر است';
    if (b.endMinute! <= b.startMinute!) return 'ساعت پایان باید بعد از ساعت شروع باشد';
  }
  const wd = b.weekdays ?? [];
  if (wd.length > 7 || wd.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(wd).size !== wd.length) return 'روز هفته نامعتبر است';
  if ((b.reason ?? '').length > 200) return 'توضیح حداکثر ۲۰۰ نویسه می‌تواند باشد';
  return null;
}
