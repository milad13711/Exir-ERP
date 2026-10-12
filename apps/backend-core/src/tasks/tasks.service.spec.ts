import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service.js';

type Matrix = { canViewAll: boolean; canViewOwn: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };

function setup(opts: { me: string; matrix: Matrix; task?: Record<string, unknown> | null }) {
  const task = opts.task === undefined ? null : opts.task;
  const taskFindFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
    // emulate the DB applying the scope: only return the task when the where has no scope or it matches
    if (!task) return null;
    const scope = (args.where.OR as Array<Record<string, unknown>> | undefined) ?? null;
    if (!scope) return task;
    const ok = scope.some((c) => c.createdByUserId === task.createdByUserId || (c.assignedUserId && c.assignedUserId === task.assignedUserId) || c.assignees);
    return ok ? task : null;
  });
  const db = {
    user: { findUnique: vi.fn(async () => ({ id: opts.me })), findMany: vi.fn(async () => []), count: vi.fn(async (a: { where: { id: { in: string[] } } }) => a.where.id.in.length) },
    task: {
      findFirst: taskFindFirst,
      findUniqueOrThrow: vi.fn(async () => ({ ...task, status: 'DONE' })),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 't-new', number: 1, status: 'NEW', assignees: [], checklist: [], ...a.data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => task),
    },
    taskAssignee: { upsert: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    taskEvent: { create: vi.fn() },
    taskResult: { create: vi.fn(async () => ({ id: 'r1' })), findFirst: vi.fn(async () => null), update: vi.fn() },
    taskComment: { create: vi.fn() },
    attachment: { createMany: vi.fn() },
    activityLog: { create: vi.fn() },
    moduleSetting: { findUnique: vi.fn(async () => null) },
  };
  const permissions = {
    getEffective: vi.fn(async () => opts.matrix),
    assertCreate: vi.fn(async () => undefined),
    assertDelete: vi.fn(async () => undefined),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const webhooks = { dispatch: vi.fn(async () => undefined) };
  const svc = new TasksService(permissions as never, notifications as never, webhooks as never);
  const ctx = { auth: { role: 'MEMBER', sub: 'g1', type: 'user' }, tenantId: 'tn', tenantDb: db } as never;
  return { svc, ctx, db, notifications };
}

const OWN: Matrix = { canViewAll: false, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false };
const ALL: Matrix = { ...OWN, canViewAll: true };
const baseTask = (over: Record<string, unknown> = {}) => ({
  id: 't1', number: 5, title: 'x', status: 'NEW', priority: 'NORMAL', isPublished: true, createdByUserId: 'boss', assignedUserId: 'emp', assignees: [{ id: 'a', taskId: 't1', userId: 'emp', seenAt: null, createdAt: new Date() }], expiredFrom: null, startedAt: null, ...over,
});

describe('TasksService permissions', () => {
  it('404 when the task is out of scope (not creator/assignee)', async () => {
    const { svc, ctx } = setup({ me: 'stranger', matrix: OWN, task: null });
    await expect(svc.start(ctx, 't1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.detail(ctx, 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assignee cannot approve, return, reassign or cancel', async () => {
    const { svc, ctx } = setup({ me: 'emp', matrix: OWN, task: baseTask({ status: 'DONE' }) });
    await expect(svc.approve(ctx, 't1', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.returnForFix(ctx, 't1', { note: 'redo' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reassign(ctx, 't1', { assigneeIds: ['x'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.cancel(ctx, 't1', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.update(ctx, 't1', { title: 'hack' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the creator (not an assignee) cannot do assignee actions', async () => {
    const { svc, ctx } = setup({ me: 'boss', matrix: OWN, task: baseTask() });
    await expect(svc.start(ctx, 't1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.submitResult(ctx, 't1', { text: 'done' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reportProblem(ctx, 't1', { body: 'broken' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.requestExtension(ctx, 't1', { proposedDueAt: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creator can approve a submitted result and the assignee gets notified', async () => {
    const { svc, ctx, db, notifications } = setup({ me: 'boss', matrix: OWN, task: baseTask({ status: 'DONE' }) });
    await svc.approve(ctx, 't1', { note: 'ok' });
    expect(db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1', status: 'DONE' }, data: expect.objectContaining({ status: 'APPROVED' }) }));
    expect(db.taskEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'approved', fromStatus: 'DONE', toStatus: 'APPROVED' }) });
    expect(notifications.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'emp', type: 'task.approved' }));
  });

  it('approve is rejected from a non-DONE status (state machine enforced server-side)', async () => {
    const { svc, ctx } = setup({ me: 'boss', matrix: ALL, task: baseTask({ status: 'IN_PROGRESS' }) });
    await expect(svc.approve(ctx, 't1', {})).rejects.toThrow(/امکان‌پذیر نیست/);
  });

  it('result submission requires text or files', async () => {
    const { svc, ctx } = setup({ me: 'emp', matrix: OWN, task: baseTask({ status: 'IN_PROGRESS' }) });
    await expect(svc.submitResult(ctx, 't1', {})).rejects.toThrow(/نتیجه/);
  });

  it('assignee result on a managed task goes to DONE (awaiting approval), personal tasks auto-approve', async () => {
    const a = setup({ me: 'emp', matrix: OWN, task: baseTask({ status: 'IN_PROGRESS' }) });
    await a.svc.submitResult(a.ctx, 't1', { text: 'finished' });
    expect(a.db.task.updateMany).toHaveBeenCalledTimes(1);
    expect(a.db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }));
    expect(a.notifications.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'boss', type: 'task.result_submitted' }));

    const personal = baseTask({ status: 'IN_PROGRESS', createdByUserId: 'emp' });
    const b = setup({ me: 'emp', matrix: OWN, task: personal });
    await b.svc.submitResult(b.ctx, 't1', { text: 'finished' });
    expect(b.db.task.updateMany).toHaveBeenCalledTimes(2);
    expect(b.db.task.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });

  it('seen is recorded once and moves NEW to SEEN, notifying the creator', async () => {
    const { svc, ctx, db, notifications } = setup({ me: 'emp', matrix: OWN, task: baseTask() });
    await svc.markSeen(ctx, 't1');
    expect(db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SEEN' }) }));
    expect(notifications.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'boss', type: 'task.seen' }));
  });

  it('a scheduled (unpublished) task is invisible to the assignee: markSeen does not mark it seen', async () => {
    const { svc, ctx, db } = setup({ me: 'emp', matrix: OWN, task: baseTask({ isPublished: false, createdByUserId: 'boss', assignedUserId: 'emp' }) });
    // scope emulation returns the row, but markSeen must still refuse to register a view on an unpublished task
    await svc.markSeen(ctx, 't1');
    expect(db.taskAssignee.upsert).not.toHaveBeenCalled();
    expect(db.task.updateMany).not.toHaveBeenCalled();
  });
});

describe('TasksService.create', () => {
  const dto = { title: 'کار جدید', assigneeIds: ['emp'] };

  it('immediate send: published + assignee notified, creator not self-notified', async () => {
    const { svc, ctx, db, notifications } = setup({ me: 'boss', matrix: ALL, task: baseTask() });
    await svc.create(ctx, dto);
    const data = db.task.create.mock.calls[0][0].data;
    expect(data.isPublished).toBe(true);
    expect(data.createdByUserId).toBe('boss');
    expect(data.assignedUserId).toBe('emp');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'emp', type: 'task.assigned' }));
  });

  it('future sendAt: stored unpublished and nobody is notified', async () => {
    const { svc, ctx, db, notifications } = setup({ me: 'boss', matrix: ALL, task: baseTask() });
    await svc.create(ctx, { ...dto, sendAt: new Date(Date.now() + 3_600_000).toISOString() });
    const data = db.task.create.mock.calls[0][0].data;
    expect(data.isPublished).toBe(false);
    expect(data.publishedAt).toBeNull();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('defaults to the creator when no assignee is given; multi-assignee creates one row each', async () => {
    const a = setup({ me: 'boss', matrix: ALL, task: baseTask() });
    await a.svc.create(a.ctx, { title: 'شخصی' });
    expect((a.db.task.create.mock.calls[0][0].data as { assignees: { create: unknown } }).assignees.create).toEqual([{ userId: 'boss' }]);
    const b = setup({ me: 'boss', matrix: ALL, task: baseTask() });
    await b.svc.create(b.ctx, { title: 'گروهی', assigneeIds: ['u1', 'u2', 'u1'] });
    expect((b.db.task.create.mock.calls[0][0].data as { assignees: { create: unknown } }).assignees.create).toEqual([{ userId: 'u1' }, { userId: 'u2' }]);
  });

  it('rejects reminders without a deadline and start after deadline', async () => {
    const { svc, ctx } = setup({ me: 'boss', matrix: ALL, task: baseTask() });
    await expect(svc.create(ctx, { ...dto, reminderOffsetsMin: [60] })).rejects.toThrow(/موعد/);
    await expect(svc.create(ctx, { ...dto, startAt: '2026-12-02T00:00:00Z', dueAt: '2026-12-01T00:00:00Z' })).rejects.toThrow(/شروع/);
  });
});
