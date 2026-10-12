import { ACTIVE_STATUSES, WORKING_STATUSES, type TaskStatusValue } from './task-state.js';

type Row = {
  id: string;
  status: TaskStatusValue;
  dueAt: Date | null;
  isPublished: boolean;
  sendAt: Date | null;
  reminderOffsetsMin: number[];
  remindersSentMin: number[];
  overdueNotifiedAt: Date | null;
  recurrence?: string;
  nextRecurAt?: Date | null;
};

/** وظایف زمان‌بندی‌شده‌ای که موعد ارسالشان رسیده است. */
export function selectDueForPublish<T extends Row>(tasks: T[], now: Date): T[] {
  return tasks.filter((t) => !t.isPublished && t.sendAt !== null && t.sendAt.getTime() <= now.getTime() && t.status !== 'CANCELLED');
}

/**
 * یادآوری‌هایی که باید همین الان برود: برای هر offset (دقیقه پیش از موعد) که زمانش رسیده، هنوز ارسال نشده
 * و موعد هنوز نگذشته است. اگر چند offset همزمان رسیده باشند فقط «نزدیک‌ترین به موعد» (کوچک‌ترین offset) فرستاده می‌شود
 * و بقیه هم علامت می‌خورند تا پیام تکراری نیاید.
 */
export function selectReminders<T extends Row>(tasks: T[], now: Date): Array<{ task: T; fire: number; mark: number[] }> {
  const out: Array<{ task: T; fire: number; mark: number[] }> = [];
  for (const t of tasks) {
    if (!t.isPublished || !t.dueAt || !WORKING_STATUSES.includes(t.status)) continue;
    if (t.dueAt.getTime() <= now.getTime()) continue;
    const due = t.reminderOffsetsMin.filter(
      (m) => m > 0 && !t.remindersSentMin.includes(m) && t.dueAt!.getTime() - m * 60_000 <= now.getTime(),
    );
    if (due.length === 0) continue;
    out.push({ task: t, fire: Math.min(...due), mark: due });
  }
  return out;
}

/** وظایف باز و منتشرشده‌ای که موعدشان گذشته. «NEW/SEEN/IN_PROGRESS/RETURNED» منقضی می‌شوند؛ HAS_PROBLEM/DONE دست‌نخورده می‌ماند. */
export function selectOverdue<T extends Row>(tasks: T[], now: Date): T[] {
  return tasks.filter((t) => t.isPublished && t.dueAt !== null && t.dueAt.getTime() < now.getTime() && ACTIVE_STATUSES.includes(t.status));
}

export function selectToExpire<T extends Row>(tasks: T[], now: Date): T[] {
  return selectOverdue(tasks, now).filter((t) => WORKING_STATUSES.includes(t.status));
}

/** وظایف تکرارشونده‌ای که زمان ساخت نمونه‌ی بعدی‌شان رسیده. */
export function selectRecurringDue<T extends Row>(tasks: T[], now: Date): T[] {
  return tasks.filter((t) => t.isPublished && t.recurrence && t.recurrence !== 'NONE' && t.nextRecurAt && t.nextRecurAt.getTime() <= now.getTime() && t.status !== 'CANCELLED');
}

/** نیمه‌شبِ تهران (UTC+03:30، بدون ساعت تابستانی) به‌صورت لحظه‌ی UTC — برای شمارنده‌ی «انجام‌شده‌های امروز». */
export function startOfTehranDay(now: Date): Date {
  const OFFSET = 210 * 60_000;
  const shifted = now.getTime() + OFFSET;
  return new Date(Math.floor(shifted / 86_400_000) * 86_400_000 - OFFSET);
}

/** موعد‌گذشته‌های اعلان‌نشده (برای اعلان «تأخیر»)؛ شامل HAS_PROBLEM و EXPIRED هم می‌شود. */
export function selectOverdueToNotify<T extends Row>(tasks: T[], now: Date): T[] {
  return selectOverdue(tasks, now).filter((t) => !t.overdueNotifiedAt);
}

export function humanizeMinutes(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} روز`;
  if (min % 60 === 0) return `${min / 60} ساعت`;
  return `${min} دقیقه`;
}
