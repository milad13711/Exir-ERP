import { describe, expect, it, vi } from 'vitest';
import { markTasksDelivered } from './task-delivery.js';
import { TasksService } from './tasks.service.js';

type A = { taskId: string; userId: string; deliveredAt: Date | null; seenAt: Date | null };
type T = { id: string; isPublished: boolean; assignedUserId: string | null };

/** حافظه‌ی ساده که فقط رفتار لازم Prisma را شبیه‌سازی می‌کند. */
function fake(tasks: T[], assignees: A[]) {
  const events: Array<{ taskId: string; type: string; actorUserId: string }> = [];
  const db = {
    task: {
      findMany: vi.fn(async (a: { where: { id: { in: string[] }; isPublished: boolean; OR: Array<Record<string, unknown>> } }) => {
        const userId = (a.where.OR[0] as { assignedUserId: string }).assignedUserId;
        return tasks
          .filter((t) => a.where.id.in.includes(t.id) && t.isPublished === a.where.isPublished)
          .filter((t) => t.assignedUserId === userId || assignees.some((x) => x.taskId === t.id && x.userId === userId))
          .map((t) => ({ id: t.id, assignees: assignees.filter((x) => x.taskId === t.id && x.userId === userId).map((x) => ({ deliveredAt: x.deliveredAt })) }));
      }),
    },
    taskAssignee: {
      createMany: vi.fn(async (a: { data: Array<{ taskId: string; userId: string; deliveredAt: Date }> }) => {
        for (const d of a.data) assignees.push({ taskId: d.taskId, userId: d.userId, deliveredAt: d.deliveredAt, seenAt: null });
        return { count: a.data.length };
      }),
      updateMany: vi.fn(async (a: { where: { userId: string; taskId: { in: string[] }; deliveredAt: null }; data: { deliveredAt: Date } }) => {
        let count = 0;
        for (const x of assignees) {
          if (x.userId === a.where.userId && a.where.taskId.in.includes(x.taskId) && x.deliveredAt === null) {
            x.deliveredAt = a.data.deliveredAt;
            count++;
          }
        }
        return { count };
      }),
    },
    taskEvent: {
      findMany: vi.fn(async (a: { where: { taskId: { in: string[] }; type: string; actorUserId: string } }) =>
        events.filter((e) => a.where.taskId.in.includes(e.taskId) && e.type === a.where.type && e.actorUserId === a.where.actorUserId).map((e) => ({ taskId: e.taskId })),
      ),
      createMany: vi.fn(async (a: { data: Array<{ taskId: string; type: string; actorUserId: string }> }) => {
        events.push(...a.data);
        return { count: a.data.length };
      }),
    },
  };
  return { db: db as never, raw: db, assignees, events };
}

describe('markTasksDelivered', () => {
  const tasks: T[] = [
    { id: 't1', isPublished: true, assignedUserId: 'u1' },
    { id: 't2', isPublished: false, assignedUserId: 'u1' },
    { id: 't3', isPublished: true, assignedUserId: 'u2' },
    { id: 'legacy', isPublished: true, assignedUserId: 'u1' },
  ];
  const rows = (): A[] => [
    { taskId: 't1', userId: 'u1', deliveredAt: null, seenAt: null },
    { taskId: 't2', userId: 'u1', deliveredAt: null, seenAt: null },
    { taskId: 't3', userId: 'u2', deliveredAt: null, seenAt: null },
  ];

  it('فقط ردیف خودِ کاربر و فقط وظیفه‌ی منتشرشده را علامت می‌زند', async () => {
    const f = fake(tasks, rows());
    const n = await markTasksDelivered(f.db, 'u1', ['t1', 't2', 't3']);
    expect(n).toBe(1);
    expect(f.assignees.find((a) => a.taskId === 't1')!.deliveredAt).toBeInstanceOf(Date);
    expect(f.assignees.find((a) => a.taskId === 't2')!.deliveredAt).toBeNull(); // زمان‌بندی‌شده
    expect(f.assignees.find((a) => a.taskId === 't3')!.deliveredAt).toBeNull(); // ردیف دیگری
  });

  it('idempotent: بار دوم هیچ نوشتنی ندارد و رویداد DELIVERED فقط یکی است', async () => {
    const f = fake(tasks, rows());
    await markTasksDelivered(f.db, 'u1', ['t1']);
    const first = f.assignees.find((a) => a.taskId === 't1')!.deliveredAt;
    f.raw.taskAssignee.updateMany.mockClear();
    expect(await markTasksDelivered(f.db, 'u1', ['t1'])).toBe(0);
    expect(f.raw.taskAssignee.updateMany).not.toHaveBeenCalled();
    expect(f.assignees.find((a) => a.taskId === 't1')!.deliveredAt).toBe(first);
    expect(f.events.filter((e) => e.type === 'delivered')).toHaveLength(1);
  });

  it('رقابت: اگر رویداد از قبل هست، رویداد دوم ساخته نمی‌شود', async () => {
    const f = fake(tasks, rows());
    f.events.push({ taskId: 't1', type: 'delivered', actorUserId: 'u1' });
    await markTasksDelivered(f.db, 'u1', ['t1']);
    expect(f.events).toHaveLength(1);
  });

  it('وظیفه‌ی قدیمیِ فقط-ستونی: ردیف ارجاع با deliveredAt ساخته می‌شود', async () => {
    const f = fake(tasks, rows());
    expect(await markTasksDelivered(f.db, 'u1', ['legacy'])).toBe(1);
    expect(f.assignees.find((a) => a.taskId === 'legacy')!.deliveredAt).toBeInstanceOf(Date);
  });

  it('کاربر غیرارجاع‌گیرنده/ورودی خالی: هیچ تغییری', async () => {
    const f = fake(tasks, rows());
    expect(await markTasksDelivered(f.db, 'stranger', ['t1', 't3'])).toBe(0);
    expect(await markTasksDelivered(f.db, 'u1', [])).toBe(0);
    expect(f.raw.taskAssignee.updateMany).not.toHaveBeenCalled();
  });

  it('کوئری‌ها محدودند: حداکثر ۵۰۰ شناسه', async () => {
    const f = fake(tasks, rows());
    await markTasksDelivered(f.db, 'u1', Array.from({ length: 900 }, (_, i) => `x${i}`));
    const arg = f.raw.task.findMany.mock.calls[0][0] as { where: { id: { in: string[] } } };
    expect(arg.where.id.in).toHaveLength(500);
  });
});

describe('TasksService delivered wiring', () => {
  const svcWith = (marked: string[][]) => {
    const db = {} as never;
    const svc = new TasksService({} as never, {} as never, {} as never);
    vi.spyOn(svc, 'markDelivered').mockImplementation(async (_d, _u, ids) => {
      marked.push(ids);
      return ids.length;
    });
    return { svc, db };
  };

  it('هندلر اعلان: entityType=Task یا لینک → همان وظیفه برای همان کاربر', async () => {
    const marked: string[][] = [];
    const { svc, db } = svcWith(marked);
    const id = '3f2b8a9e-1111-4222-8333-444455556666';
    expect(await svc.handleNotificationDelivered(db, { userId: 'u1', entityType: 'Task', entityId: id })).toBe(1);
    expect(await svc.handleNotificationDelivered(db, { userId: 'u1', link: `/tasks?open=${id}` })).toBe(1);
    expect(marked).toEqual([[id], [id]]);
  });

  it('هندلر اعلان: نوع دیگر نادیده گرفته می‌شود', async () => {
    const marked: string[][] = [];
    const { svc, db } = svcWith(marked);
    expect(await svc.handleNotificationDelivered(db, { userId: 'u1', entityType: 'Invoice', entityId: 'i1' })).toBe(0);
    expect(marked).toEqual([]);
  });

  it('لیست: فقط وظایفِ دریافت‌نشده‌ی منتشرشده‌ی خودِ کاربر و در یک فراخوانی', () => {
    const marked: string[][] = [];
    const { svc, db } = svcWith(marked);
    svc.markDeliveredInBackground(db, 'u1', [
      { id: 'a', isPublished: true, assignedUserId: 'u1', assignees: [{ userId: 'u1', deliveredAt: null }] },
      { id: 'b', isPublished: true, assignedUserId: 'u1', assignees: [{ userId: 'u1', deliveredAt: new Date() }] },
      { id: 'c', isPublished: false, assignedUserId: 'u1', assignees: [{ userId: 'u1', deliveredAt: null }] },
      { id: 'd', isPublished: true, assignedUserId: 'u2', assignees: [{ userId: 'u2', deliveredAt: null }] },
      { id: 'e', isPublished: true, assignedUserId: 'u1', assignees: [] },
    ]);
    expect(marked).toEqual([['a', 'e']]);
    marked.length = 0;
    svc.markDeliveredInBackground(db, null, [{ id: 'a', isPublished: true, assignedUserId: null, assignees: [] }]);
    expect(marked).toEqual([]);
  });
});
