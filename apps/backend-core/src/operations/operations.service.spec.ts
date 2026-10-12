import { describe, expect, it, vi } from 'vitest';
import { OperationsService } from './operations.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function make(actor: { userId: string | null; manager: boolean }) {
  const calls: Array<Record<string, unknown>> = [];
  const rec = (name: string, ret: unknown) =>
    vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return ret;
    });
  const db = {
    task: { groupBy: rec('groupBy', []), count: rec('count', 0), findMany: rec('task.findMany', []) },
    taskExtensionRequest: { count: rec('ext.count', 0), findMany: rec('ext.findMany', []) },
    taskEvent: { findMany: rec('event.findMany', []), groupBy: rec('event.groupBy', []) },
    taskComment: { findMany: rec('comment.findMany', []) },
    user: { findMany: rec('user.findMany', []) },
  };
  const tasks = { actor: vi.fn(async () => actor), getPrefix: vi.fn(async () => 'TASK') };
  const svc = new OperationsService(tasks as never);
  return { svc, db, calls, ctx: { tenantDb: db } as unknown as TenantRequestContext };
}

describe('OperationsService scope', () => {
  it('manager: no scope restriction on any query', async () => {
    const { svc, db, ctx } = make({ userId: 'm', manager: true });
    await svc.overview(ctx);
    const where = db.task.groupBy.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND[0]).toEqual({});
  });

  it('non-manager: every task query carries the tasks scope for the user', async () => {
    const { svc, db, ctx } = make({ userId: 'u1', manager: false });
    await svc.overview(ctx);
    await svc.workload(ctx, {});
    await svc.attention(ctx);
    await svc.trend(ctx);
    await svc.activity(ctx);
    await svc.exportCsv(ctx);
    const scope = { OR: [{ createdByUserId: 'u1' }, { isPublished: true, assignedUserId: 'u1' }, { isPublished: true, assignees: { some: { userId: 'u1' } } }] };
    const asJson = (x: unknown) => JSON.stringify(x);
    for (const fn of [db.task.groupBy, db.task.count, db.task.findMany]) {
      for (const call of fn.mock.calls) expect(asJson(call[0])).toContain(asJson(scope));
    }
    expect(asJson(db.taskExtensionRequest.count.mock.calls[0][0])).toContain(asJson(scope));
    expect(asJson(db.taskEvent.findMany.mock.calls[0][0])).toContain(asJson(scope));
  });

  it('non-manager workload returns only the caller row; activity pagination cursor', async () => {
    const { svc, db, ctx } = make({ userId: 'u1', manager: false });
    db.task.findMany.mockResolvedValueOnce([
      { status: 'NEW', dueAt: null, isPublished: true, createdAt: new Date(), completedAt: null, assignedUserId: 'u1', assignees: [{ userId: 'u2' }] },
    ]);
    const w = await svc.workload(ctx, {});
    expect(w.rows.map((r) => r.userId)).toEqual(['u1']);

    const ev = (id: string) => ({ id, taskId: 't', type: 'viewed', actorUserId: null, fromStatus: null, toStatus: null, note: null, createdAt: new Date(), task: { number: 1, title: 'x' } });
    db.taskEvent.findMany.mockResolvedValueOnce([ev('a'), ev('b'), ev('c')]);
    const page = await svc.activity(ctx, undefined, '2');
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('b');
    expect(page.items[0].actorName).toBe('سیستم');
  });

  it('non-manager attention skips unseen-task query', async () => {
    const { svc, db, ctx } = make({ userId: 'u1', manager: false });
    const r = await svc.attention(ctx);
    expect(r.items).toEqual([]);
    // approvals, problems, overdue, scheduled → 4 task.findMany (no unseen)
    expect(db.task.findMany).toHaveBeenCalledTimes(4);
  });
});
