import { describe, expect, it, vi } from 'vitest';
import { NotificationReminderService } from './notification-reminder.service.js';
import { categoryForType, defaultPushFor, isImportantType, NOTIFICATION_CATEGORIES, planDelivery, selectDueReminders, clampReminderHours, reminderWindowOpen, REMINDER_DAILY_CAP, type ReminderCandidate } from './push-logic.js';

// 2026-11-08 (یکشنبه) 12:00 تهران = 08:30Z
const NOON = new Date('2026-11-08T08:30:00Z');
const hoursAgo = (h: number, from = NOON) => new Date(from.getTime() - h * 3600_000);
const cand = (o: Partial<ReminderCandidate> = {}): ReminderCandidate => ({ id: 'n1', createdAt: hoursAgo(5), readAt: null, remindedAt: null, important: true, type: 'report.referred', ...o });

describe('categories and defaults', () => {
  it('maps referral-style types to the referrals category (not silent system)', () => {
    expect(categoryForType('report.referred')).toBe('referrals');
    expect(categoryForType('referral.assigned')).toBe('referrals');
    expect(categoryForType('knowledge.report_referred')).toBe('referrals');
    expect(NOTIFICATION_CATEGORIES).toContain('referrals');
  });
  it('push is ON by default for referrals/approvals/tasks/correspondence, OFF only for marketing', () => {
    for (const c of ['referrals', 'approvals', 'tasks', 'correspondence', 'messenger', 'reminders', 'system'] as const) expect(defaultPushFor(c)).toBe(true);
    expect(defaultPushFor('marketing')).toBe(false);
    expect(planDelivery(null, { category: 'referrals', critical: false, now: NOON })).toMatchObject({ push: true, inApp: true });
  });
  it('an explicit per-category mute is still honoured', () => {
    expect(planDelivery({ categoryPrefs: { referrals: { push: false } } }, { category: 'referrals', critical: false, now: NOON }).push).toBe(false);
  });
  it('important classification', () => {
    expect(isImportantType('report.referred', 'referrals')).toBe(true);
    expect(isImportantType('task.assigned', 'tasks')).toBe(true);
    expect(isImportantType('task.comment', 'tasks')).toBe(false);
    expect(isImportantType('billing.invoice_issued', 'system')).toBe(false);
    expect(isImportantType('notification.reminder', 'referrals')).toBe(false);
    expect(isImportantType('referral.assigned', 'approvals')).toBe(true);
    expect(isImportantType('referral.forwarded', 'approvals')).toBe(true);
    expect(isImportantType('referral.accepted', 'approvals')).toBe(false);
    expect(isImportantType('referral.cancelled', 'approvals')).toBe(false);
    expect(isImportantType('leave.reviewed', 'approvals')).toBe(false);
    expect(isImportantType('task.comment', 'tasks', true)).toBe(true);
  });
});

describe('selectDueReminders', () => {
  it('default: reminds important unread after 4h, not before', () => {
    expect(selectDueReminders([cand({ createdAt: hoursAgo(5) })], null, NOON)).toHaveLength(1);
    expect(selectDueReminders([cand({ createdAt: hoursAgo(3) })], null, NOON)).toHaveLength(0);
  });
  it('skips read, already reminded, non-important, reminders themselves, and stale (>72h)', () => {
    const items = [cand({ id: 'a', readAt: NOON }), cand({ id: 'b', remindedAt: NOON }), cand({ id: 'c', important: false }), cand({ id: 'd', type: 'notification.reminder' }), cand({ id: 'e', createdAt: hoursAgo(80) })];
    expect(selectDueReminders(items, null, NOON)).toHaveLength(0);
  });
  it('respects reminderEnabled=false and a custom threshold', () => {
    expect(selectDueReminders([cand()], { reminderEnabled: false }, NOON)).toHaveLength(0);
    expect(selectDueReminders([cand({ createdAt: hoursAgo(2.5) })], { reminderAfterHours: 2 }, NOON)).toHaveLength(1);
  });
  it('only inside work hours and outside quiet hours', () => {
    const night = new Date('2026-11-08T20:00:00Z'); // 23:30 تهران
    expect(reminderWindowOpen(null, night)).toBe(false);
    expect(selectDueReminders([cand({ createdAt: hoursAgo(9, night) })], null, night)).toHaveLength(0);
    const quietNoon = { quietHoursEnabled: true, quietStart: '11:00', quietEnd: '13:00' };
    expect(selectDueReminders([cand()], quietNoon, NOON)).toHaveLength(0);
  });
  it('clamps hours', () => {
    expect(clampReminderHours(0)).toBe(1);
    expect(clampReminderHours(500)).toBe(48);
    expect(clampReminderHours('x')).toBe(4);
  });
});

/** دیتابیس درون‌حافظه‌ای کوچک برای کرون. */
function fakeDb(rows: any[], prefs: Record<string, any> = {}) {
  const db: any = {
    notification: {
      findMany: vi.fn(async () => rows.filter((r) => r.important && !r.readAt && !r.remindedAt)),
      count: vi.fn(async ({ where }: any) => rows.filter((r) => r.userId === where.userId && r.type === where.type).length),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id && x.userId === where.userId);
        if (!r || r.remindedAt || r.readAt) return { count: 0 };
        r.remindedAt = data.remindedAt;
        return { count: 1 };
      }),
    },
    notificationPreference: { findUnique: vi.fn(async ({ where }: any) => prefs[where.userId] ?? null) },
  };
  return db;
}
const mkRow = (id: string, userId: string, o: any = {}) => ({ id, userId, type: 'report.referred', category: 'referrals', title: `گزارش ${id}`, body: 'b', link: `/reports?id=${id}`, entityType: 'report', entityId: id, important: true, readAt: null, remindedAt: null, createdAt: hoursAgo(5), ...o });

describe('NotificationReminderService.sweepTenant', () => {
  const make = (notify = vi.fn(async (..._a: any[]) => undefined)) => ({ svc: new NotificationReminderService({} as any, {} as any, { notify } as any), notify });

  it('sends one reminder with a deep link and is idempotent across runs', async () => {
    const rows = [mkRow('r1', 'u1')];
    const db = fakeDb(rows);
    const { svc, notify } = make();
    expect(await svc.sweepTenant(db, NOON)).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ userId: 'u1', type: 'notification.reminder', link: '/reports?id=r1', important: false });
    expect(await svc.sweepTenant(db, NOON)).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('two instances racing on the same row only remind once', async () => {
    const rows = [mkRow('r1', 'u1')];
    const db = fakeDb(rows);
    const a = make();
    const b = make();
    const [x, y] = await Promise.all([a.svc.sweepTenant(db, NOON), b.svc.sweepTenant(db, NOON)]);
    expect(x + y).toBe(1);
    expect(a.notify.mock.calls.length + b.notify.mock.calls.length).toBe(1);
  });

  it('digests several items into a single message per user per run', async () => {
    const rows = [mkRow('r1', 'u1'), mkRow('r2', 'u1'), mkRow('r3', 'u2')];
    const { svc, notify } = make();
    expect(await svc.sweepTenant(fakeDb(rows), NOON)).toBe(2);
    const u1 = notify.mock.calls.map((c: any) => c[1]).find((i: any) => i.userId === 'u1');
    expect(u1.title).toContain('2');
    expect(u1.link).toBe('/notifications?filter=important');
    expect(rows.every((r) => r.remindedAt)).toBe(true);
  });

  it('honours the per-day cap and per-user opt-out; items stay un-claimed', async () => {
    const capRows = [mkRow('r1', 'u1'), ...Array.from({ length: REMINDER_DAILY_CAP }, (_, i) => mkRow(`x${i}`, 'u1', { type: 'notification.reminder', important: false }))];
    const { svc, notify } = make();
    expect(await svc.sweepTenant(fakeDb(capRows), NOON)).toBe(0);
    expect(capRows[0].remindedAt).toBeNull();
    const optOut = [mkRow('r9', 'u3')];
    expect(await svc.sweepTenant(fakeDb(optOut, { u3: { reminderEnabled: false } }), NOON)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing outside work hours', async () => {
    const night = new Date('2026-11-08T20:00:00Z');
    const rows = [mkRow('r1', 'u1', { createdAt: hoursAgo(9, night) })];
    const { svc, notify } = make();
    expect(await svc.sweepTenant(fakeDb(rows), night)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
