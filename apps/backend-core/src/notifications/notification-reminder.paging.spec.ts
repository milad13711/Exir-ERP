import { describe, expect, it, vi } from 'vitest';
import { NotificationReminderService } from './notification-reminder.service.js';

const mk = (id: string, userId: string, createdAt: Date) => ({ id, userId, createdAt, important: true, readAt: null, remindedAt: null, type: 'task.assigned', title: 't', body: null, link: null, category: null, entityType: null, entityId: null });

describe('reminder sweep paging', () => {
  it('rows skipped for one user (reminders disabled) do not starve later pages for other users', async () => {
    const now = new Date('2026-11-07T08:00:00Z'); // 11:30 Tehran, working hours
    const old = new Date(now.getTime() - 10 * 3600_000);
    const page1 = Array.from({ length: 500 }, (_, i) => mk(`a${i}`, 'blocked', old));
    const page2 = [mk('b1', 'ok', old)];
    const findMany = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const db = {
      notification: { findMany, count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      notificationPreference: { findUnique: vi.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === 'blocked' ? { reminderEnabled: false } : null)) },
    };
    const notify = vi.fn();
    const svc = new NotificationReminderService({} as never, {} as never, { notify } as never);
    const sent = await svc.sweepTenant(db as never, now);
    expect(sent).toBe(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].cursor).toEqual({ id: 'a499' });
    expect(notify.mock.calls[0][1].userId).toBe('ok');
  });
});
