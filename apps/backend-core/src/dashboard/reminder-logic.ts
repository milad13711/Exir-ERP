import { fromTehran, tehranParts } from '../booking/tehran-time.js';

/** منطق خالص آلارم یادآوری تقویم (بدون وابستگی به دیتابیس) — برای کرون و تست. */

export type RepeatRule = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export const REPEAT_RULES: RepeatRule[] = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'];
export const REMINDER_CHANNELS = ['IN_APP', 'PUSH', 'SMS', 'EMAIL'] as const;
export type ReminderChannelName = (typeof REMINDER_CHANNELS)[number];
/** پیش‌هشدارهای مجاز (دقیقه): ۰ = در لحظه‌ی موعد. */
export const ALLOWED_LEAD_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
/** فرصت جبران آلارم‌های از دست‌رفته (مثلاً قطعی سرور). */
export const CATCH_UP_MS = 60 * 60 * 1000;
export const ALL_DAY_MINUTES = 8 * 60; // ساعت ۰۸:۰۰ تهران
export const SNOOZE_DEFAULT_MIN = 10;
export const SMS_DAILY_CAP_PER_USER = 10;

export type ReminderLike = {
  id: string;
  status: string;
  remindAt: Date | null;
  snoozedUntil: Date | null;
  leadMinutes: number[];
  alertsSentMin: number[];
  repeatRule: string;
  nextSpawned: boolean;
};

/** زمان مؤثر آلارم اصلی: اگر تعویق خورده باشد زمان تعویق. */
export function effectiveTime(r: Pick<ReminderLike, 'remindAt' | 'snoozedUntil'>): Date | null {
  return r.snoozedUntil ?? r.remindAt;
}

/** «YYYY-MM-DD» + «HH:mm» (وقت تهران) → لحظه‌ی مطلق. */
export function buildRemindAt(dateKey: string, time: string | undefined | null, allDay: boolean): Date {
  const key = dateKey.slice(0, 10);
  if (allDay || !time) return fromTehran(key, ALL_DAY_MINUTES);
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) throw new Error('INVALID_TIME');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error('INVALID_TIME');
  return fromTehran(key, h * 60 + min);
}

export function normalizeLeads(leads: number[] | undefined | null): number[] {
  const set = new Set((leads ?? [0]).filter((n) => ALLOWED_LEAD_MINUTES.includes(n)));
  if (set.size === 0) set.add(0);
  return [...set].sort((a, b) => b - a);
}

/** پیش‌هشدارهایی که هنگام ثبت از قبل گذشته‌اند (موعدشان رسیده) نباید فوراً شلیک شوند. */
export function leadsAlreadyPast(remindAt: Date, leads: number[], now: Date): number[] {
  return leads.filter((l) => l > 0 && remindAt.getTime() - l * 60_000 <= now.getTime());
}

export type DueAlert = { id: string; offset: number };

/**
 * آلارم‌های سررسیده‌ی یک رخداد:
 *  - پیش‌هشدار (offset>0): از remindAt-offset تا خودِ موعد (بعد از موعد بی‌معناست).
 *  - آلارم اصلی (offset=0): از زمان مؤثر (موعد یا تعویق) تا CATCH_UP_MS بعد.
 * مواردی که قبلاً در alertsSentMin ثبت شده‌اند (یکتایی) یا رخداد انجام‌شده است، حذف می‌شوند.
 */
export function dueAlerts(r: ReminderLike, now: Date): number[] {
  if (r.status !== 'PENDING' || !r.remindAt) return [];
  const out: number[] = [];
  const eff = effectiveTime(r)!.getTime();
  const t = now.getTime();
  for (const lead of r.leadMinutes) {
    if (r.alertsSentMin.includes(lead)) continue;
    if (lead === 0) {
      if (eff <= t && t < eff + CATCH_UP_MS) out.push(0);
    } else if (!r.snoozedUntil) {
      const fireAt = r.remindAt.getTime() - lead * 60_000;
      if (fireAt <= t && t < r.remindAt.getTime()) out.push(lead);
    }
  }
  return out.sort((a, b) => b - a);
}

/** رخدادهای PENDING که آلارم اصلی‌شان از پنجره‌ی جبران هم گذشته و هرگز شلیک نشده‌اند. */
export function isMissed(r: ReminderLike, now: Date): boolean {
  if (r.status !== 'PENDING' || !r.remindAt) return false;
  if (r.alertsSentMin.includes(0)) return false;
  if (!r.leadMinutes.includes(0)) return false;
  return effectiveTime(r)!.getTime() + CATCH_UP_MS <= now.getTime();
}

function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** رخداد بعدیِ تکرار — همیشه با همان ساعت دیواریِ تهران؛ اگر هنوز در گذشته باشد جلو می‌رود تا بعد از `after`. */
export function nextOccurrence(remindAt: Date, rule: string, after: Date): Date | null {
  if (rule !== 'DAILY' && rule !== 'WEEKLY' && rule !== 'MONTHLY') return null;
  const { dateKey, minutes } = tehranParts(remindAt);
  const [y, m, d] = dateKey.split('-').map(Number);
  let cur = remindAt;
  for (let i = 1; i <= 800; i++) {
    let key: string;
    if (rule === 'DAILY') key = addDaysKey(dateKey, i);
    else if (rule === 'WEEKLY') key = addDaysKey(dateKey, 7 * i);
    else {
      const total = m - 1 + i;
      const ny = y + Math.floor(total / 12);
      const nm = (total % 12) + 1;
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); // آخر ماه میلادی
      key = `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    }
    cur = fromTehran(key, minutes);
    if (cur.getTime() > after.getTime()) return cur;
  }
  return null;
}

/** پیام اعلان بر اساس نوع آلارم. */
export function alertText(title: string, offset: number): string {
  if (offset === 0) return `یادآوری: ${title}`;
  const label =
    offset % 1440 === 0 ? `${offset / 1440} روز` : offset % 60 === 0 ? `${offset / 60} ساعت` : `${offset} دقیقه`;
  return `یادآوری: ${title} — ${label} دیگر`;
}

/** فقط ساعت و دقیقه‌ی وقت تهران «HH:mm». */
export function tehranHHmm(d: Date): string {
  const { minutes } = tehranParts(d);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
