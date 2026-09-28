import { describe, expect, it, vi } from 'vitest';
import { rollPendingToNextDay } from './checklist-rollover.js';

const TODAY = new Date('2026-09-26T00:00:00.000Z');
const TOMORROW = new Date('2026-09-27T00:00:00.000Z');

/**
 * منبع باگ احتمالی: هر فیلتری که رول‌اُوِر را بر اساس priority محدود کند (مثلاً یک where اشتباه
 * یا مقایسه‌ی نادرست با ترتیب enum) باید اینجا افشا شود — چون هر سه اولویت با هم و در یک صدا
 * بررسی می‌شوند، نه جداگانه.
 */
function makeDb(items: Array<Record<string, unknown>>) {
  return {
    dailyChecklistItem: {
      findMany: vi.fn(async (args: { where: { userId: string; date: Date; done: boolean } }) =>
        items.filter((i) => i.userId === args.where.userId && (i.date as Date).getTime() === args.where.date.getTime() && i.done === args.where.done),
      ),
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('rollPendingToNextDay', () => {
  it('carries over every not-done item regardless of priority, and never carries over done items', async () => {
    const items = [
      { id: '1', userId: 'u1', date: TODAY, title: 'فوری مانده', description: null, done: false, priority: 'URGENT', createdByUserId: 'u1', order: 0 },
      { id: '2', userId: 'u1', date: TODAY, title: 'فوری انجام‌شده', description: null, done: true, priority: 'URGENT', createdByUserId: 'u1', order: 1 },
      { id: '3', userId: 'u1', date: TODAY, title: 'متوسط مانده', description: null, done: false, priority: 'MEDIUM', createdByUserId: 'u1', order: 2 },
      { id: '4', userId: 'u1', date: TODAY, title: 'متوسط انجام‌شده', description: null, done: true, priority: 'MEDIUM', createdByUserId: 'u1', order: 3 },
      { id: '5', userId: 'u1', date: TODAY, title: 'عادی مانده', description: null, done: false, priority: 'NORMAL', createdByUserId: 'u1', order: 4 },
      { id: '6', userId: 'u1', date: TODAY, title: 'عادی انجام‌شده', description: null, done: true, priority: 'NORMAL', createdByUserId: 'u1', order: 5 },
    ];
    const db = makeDb(items);

    const count = await rollPendingToNextDay(db as never, 'u1', TODAY);

    expect(count).toBe(3);
    expect(db.dailyChecklistItem.createMany).toHaveBeenCalledTimes(1);
    const created = db.dailyChecklistItem.createMany.mock.calls[0][0].data as Array<{ title: string; priority: string; date: Date; carriedOver: boolean }>;

    // هر سه اولویت باید منتقل شوند — نه فقط NORMAL
    const priorities = created.map((c) => c.priority).sort();
    expect(priorities).toEqual(['MEDIUM', 'NORMAL', 'URGENT']);
    expect(created).toHaveLength(3);
    expect(created.every((c) => c.date.getTime() === TOMORROW.getTime())).toBe(true);
    expect(created.every((c) => c.carriedOver === true)).toBe(true);

    // آیتم‌های انجام‌شده (هر اولویتی) نباید منتقل شوند
    const carriedTitles = created.map((c) => c.title);
    expect(carriedTitles).not.toContain('فوری انجام‌شده');
    expect(carriedTitles).not.toContain('متوسط انجام‌شده');
    expect(carriedTitles).not.toContain('عادی انجام‌شده');
  });
});
