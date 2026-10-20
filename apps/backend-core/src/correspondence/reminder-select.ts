/** انتخاب خالص یادآوری‌ها — هم‌خوان با پرس‌وجوی cron؛ تست‌پذیر بدون دیتابیس. */
export const DUE_SOON_MS = 24 * 3600_000;

export type ReferralFacts = { status: string; kind: string; dueAt: Date | null; dueNotifiedAt: Date | null; overdueNotifiedAt: Date | null };

export function classifyReferral(r: ReferralFacts, now: Date): 'DUE_SOON' | 'OVERDUE' | null {
  if (r.kind !== 'ACTION' || !['PENDING', 'SEEN'].includes(r.status) || !r.dueAt) return null;
  if (r.dueAt.getTime() < now.getTime()) return r.overdueNotifiedAt ? null : 'OVERDUE';
  if (r.dueAt.getTime() - now.getTime() <= DUE_SOON_MS) return r.dueNotifiedAt ? null : 'DUE_SOON';
  return null;
}

export const OPEN_INCOMING = ['REGISTERED', 'REFERRED', 'IN_PROGRESS'] as const;

export type ResponseFacts = { type: string; status: string; responseDueAt: Date | null; archivedAt: Date | null; sentReminders: string[] };

/** مهلت پاسخ نامه‌ی وارده؛ هر نوع یادآوری برای هر نامه فقط یک‌بار. */
export function classifyResponseDue(l: ResponseFacts, now: Date): 'RESPONSE_DUE' | 'RESPONSE_OVERDUE' | null {
  if (l.type !== 'INCOMING' || !l.responseDueAt || l.archivedAt || !(OPEN_INCOMING as readonly string[]).includes(l.status)) return null;
  if (l.responseDueAt.getTime() < now.getTime()) return l.sentReminders.includes('RESPONSE_OVERDUE') ? null : 'RESPONSE_OVERDUE';
  if (l.responseDueAt.getTime() - now.getTime() <= DUE_SOON_MS) return l.sentReminders.includes('RESPONSE_DUE') ? null : 'RESPONSE_DUE';
  return null;
}
