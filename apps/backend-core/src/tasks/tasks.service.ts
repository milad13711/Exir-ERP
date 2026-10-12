import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import type { CreateTaskDto } from './dto/create-task.dto.js';
import type { UpdateTaskDto } from './dto/update-task.dto.js';
import type {
  CommentDto,
  ExtensionDecisionDto,
  ExtensionRequestDto,
  NoteDto,
  ProblemDto,
  ReassignDto,
  RequiredNoteDto,
  ResolveProblemDto,
  SubmitResultDto,
} from './dto/task-actions.dto.js';
import { startOfTehranDay } from './task-cron-logic.js';
import { DEFAULT_TASK_PREFIX, formatTaskCode, parseTaskNumber, sanitizeTaskPrefix } from './task-number.js';
import { nextOccurrence } from './task-recurrence.js';
import { canManageTask, isTaskAssignee, resolveTaskRole, taskScopeWhere, type TaskRole } from './task-scope.js';
import {
  ACTIVE_STATUSES,
  availableActions,
  canTransition,
  nextStatus,
  requiresApproval,
  TaskTransitionError,
  WORKING_STATUSES,
  type TaskAction,
  type TaskStatusValue,
} from './task-state.js';

export type TaskActor = { userId: string | null; manager: boolean };

export const TASK_SETTINGS_MODULE = 'tasks';
export const TASK_PREFIX_KEY = 'numberPrefix';

const TASK_INCLUDE = {
  assignee: { select: { name: true } },
  checklist: { orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }] },
  assignees: true,
};

type TaskRow = Awaited<ReturnType<TenantPrismaClient['task']['findFirstOrThrow']>> & {
  assignees: Array<{ id: string; taskId: string; userId: string; seenAt: Date | null; createdAt: Date }>;
};

export type TaskListFilters = {
  assigneeId?: string;
  status?: string;
  priority?: string;
  from?: string;
  to?: string;
  dateField?: string;
  q?: string;
  relatedModule?: string;
  relatedEntityId?: string;
  mine?: string;
  limit?: number;
};

const dedupe = (ids: string[]) => [...new Set(ids.filter((s) => s))];

/** لینک عمیق اعلان‌ها به همین وظیفه. */
export const taskLink = (id: string) => `/tasks?open=${id}`;

@Injectable()
export class TasksService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ── دسترسی ────────────────────────────────────────────────────────────

  async actor(ctx: TenantRequestContext): Promise<TaskActor> {
    const matrix = await this.permissions.getEffective(ctx, 'tasks');
    if (!matrix.canViewAll && !matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    const userId = await resolveTenantUserId(ctx);
    return { userId, manager: matrix.canViewAll };
  }

  private async load(ctx: TenantRequestContext, actor: TaskActor, id: string): Promise<TaskRow> {
    const task = await ctx.tenantDb.task.findFirst({
      where: { id, ...taskScopeWhere(actor.manager, actor.userId) },
      include: { assignees: true },
    });
    if (!task) throw new NotFoundException('وظیفه یافت نشد');
    return task as TaskRow;
  }

  private roleOf(task: TaskRow, actor: TaskActor): TaskRole {
    return resolveTaskRole(task, actor.userId, actor.manager);
  }

  private assertAssignee(role: TaskRole) {
    if (!role.assignee) throw new ForbiddenException('فقط ارجاع‌گیرنده‌ی وظیفه می‌تواند این کار را انجام دهد');
  }

  private assertManage(role: TaskRole) {
    if (!canManageTask(role)) throw new ForbiddenException('فقط سازنده‌ی وظیفه یا مدیر می‌تواند این کار را انجام دهد');
  }

  private assigneeIdsOf(task: Pick<TaskRow, 'assignedUserId' | 'assignees'>): string[] {
    return dedupe([...(task.assignedUserId ? [task.assignedUserId] : []), ...task.assignees.map((a) => a.userId)]);
  }

  // ── تنظیمات (پیشوند شماره) ─────────────────────────────────────────────

  async getPrefix(db: TenantPrismaClient): Promise<string> {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: TASK_SETTINGS_MODULE, key: TASK_PREFIX_KEY } } });
    return sanitizeTaskPrefix(row?.value ?? DEFAULT_TASK_PREFIX);
  }

  async getSettings(ctx: TenantRequestContext) {
    await this.actor(ctx);
    return { numberPrefix: await this.getPrefix(ctx.tenantDb) };
  }

  async updateSettings(ctx: TenantRequestContext, prefix: string) {
    const actor = await this.actor(ctx);
    if (!actor.manager) throw new ForbiddenException('فقط مدیر می‌تواند پیشوند شماره‌ی وظایف را تغییر دهد');
    const value = sanitizeTaskPrefix(prefix);
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: TASK_SETTINGS_MODULE, key: TASK_PREFIX_KEY } },
      create: { moduleCode: TASK_SETTINGS_MODULE, key: TASK_PREFIX_KEY, value },
      update: { value },
    });
    return { numberPrefix: value };
  }

  // ── نمایش ─────────────────────────────────────────────────────────────

  /** افزودن شماره‌ی نمایشی، نام‌ها، نقش کاربر جاری و اقدام‌های مجاز به هر وظیفه. */
  private async decorate(ctx: TenantRequestContext, actor: TaskActor, tasks: TaskRow[]) {
    const prefix = await this.getPrefix(ctx.tenantDb);
    const userIds = dedupe(tasks.flatMap((t) => [...this.assigneeIdsOf(t), ...(t.createdByUserId ? [t.createdByUserId] : [])]));
    const users = userIds.length ? await ctx.tenantDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const now = Date.now();
    return tasks.map((t) => {
      const role = this.roleOf(t, actor);
      const rows = new Map(t.assignees.map((a) => [a.userId, a]));
      const assignees = this.assigneeIdsOf(t).map((userId) => ({ userId, name: names.get(userId) ?? 'کاربر حذف‌شده', seenAt: rows.get(userId)?.seenAt ?? null }));
      const manage = canManageTask(role);
      return {
        ...t,
        assignees,
        code: formatTaskCode(prefix, t.number),
        createdBy: t.createdByUserId ? { id: t.createdByUserId, name: names.get(t.createdByUserId) ?? 'کاربر حذف‌شده' } : null,
        isOverdue: !!t.dueAt && t.dueAt.getTime() < now && ACTIVE_STATUSES.includes(t.status as TaskStatusValue),
        role: { manager: actor.manager, creator: role.creator, assignee: role.assignee, canManage: manage },
        actions: availableActions(t.status as TaskStatusValue, { manager: manage, assignee: role.assignee }),
      };
    });
  }

  private async view(ctx: TenantRequestContext, actor: TaskActor, id: string) {
    const task = await ctx.tenantDb.task.findFirst({ where: { id, ...taskScopeWhere(actor.manager, actor.userId) }, include: TASK_INCLUDE });
    if (!task) throw new NotFoundException('وظیفه یافت نشد');
    return (await this.decorate(ctx, actor, [task as unknown as TaskRow]))[0];
  }

  private buildFilterWhere(f: TaskListFilters, now: Date): Record<string, unknown>[] {
    const and: Record<string, unknown>[] = [];
    if (f.relatedModule) and.push({ relatedModule: f.relatedModule });
    if (f.relatedEntityId) and.push({ relatedEntityId: f.relatedEntityId });
    if (f.assigneeId) and.push({ OR: [{ assignedUserId: f.assigneeId }, { assignees: { some: { userId: f.assigneeId } } }] });
    if (f.priority && ['NORMAL', 'MEDIUM', 'URGENT'].includes(f.priority)) and.push({ priority: f.priority });
    if (f.status) {
      const parts = f.status.split(',').map((s) => s.trim()).filter(Boolean);
      const statuses: string[] = [];
      for (const p of parts) {
        if (p === 'OVERDUE') and.push({ dueAt: { lt: now }, status: { in: ACTIVE_STATUSES }, isPublished: true });
        else if (p === 'ACTIVE') statuses.push(...ACTIVE_STATUSES);
        else if (p === 'NEW') statuses.push('NEW', 'OPEN');
        else statuses.push(p);
      }
      if (statuses.length) and.push({ status: { in: statuses } });
    }
    const field = f.dateField === 'createdAt' ? 'createdAt' : 'dueAt';
    const range: Record<string, Date> = {};
    if (f.from && !Number.isNaN(Date.parse(f.from))) range.gte = new Date(f.from);
    if (f.to && !Number.isNaN(Date.parse(f.to))) range.lte = new Date(f.to);
    if (Object.keys(range).length) and.push({ [field]: range });
    const q = f.q?.trim();
    if (q) {
      const num = parseTaskNumber(q);
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } },
          ...(num !== null ? [{ number: num }] : []),
        ],
      });
    }
    return and;
  }

  async list(ctx: TenantRequestContext, f: TaskListFilters) {
    const actor = await this.actor(ctx);
    const scope = taskScopeWhere(actor.manager, actor.userId);
    const and = this.buildFilterWhere(f, new Date());
    if (f.mine === '1' && actor.userId) {
      and.push({ OR: [{ createdByUserId: actor.userId }, { assignedUserId: actor.userId }, { assignees: { some: { userId: actor.userId } } }] });
    }
    const tasks = await ctx.tenantDb.task.findMany({
      where: { AND: [scope, ...and] },
      include: TASK_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Math.max(Number(f.limit) || 300, 1), 500),
    });
    return this.decorate(ctx, actor, tasks as unknown as TaskRow[]);
  }

  /** شمارنده‌های داشبورد مدیر — با همان دامنه‌ی دید (غیرمدیر فقط وظایف خودش را می‌شمارد). */
  async summary(ctx: TenantRequestContext, assigneeId?: string) {
    const actor = await this.actor(ctx);
    const now = new Date();
    const base: Record<string, unknown>[] = [taskScopeWhere(actor.manager, actor.userId)];
    if (assigneeId) base.push({ OR: [{ assignedUserId: assigneeId }, { assignees: { some: { userId: assigneeId } } }] });
    const count = (extra: Record<string, unknown>) => ctx.tenantDb.task.count({ where: { AND: [...base, extra] } });
    const [fresh, inProgress, overdue, awaitingApproval, hasProblem, doneToday, scheduled] = await Promise.all([
      count({ status: { in: ['NEW', 'OPEN', 'SEEN'] }, isPublished: true }),
      count({ status: { in: ['IN_PROGRESS', 'RETURNED_FOR_FIX'] } }),
      count({ isPublished: true, dueAt: { lt: now }, status: { in: ACTIVE_STATUSES } }),
      count({ status: 'DONE' }),
      count({ status: 'HAS_PROBLEM' }),
      count({ status: { in: ['DONE', 'APPROVED'] }, completedAt: { gte: startOfTehranDay(now) } }),
      count({ isPublished: false }),
    ]);
    return { new: fresh, inProgress, overdue, awaitingApproval, hasProblem, doneToday, scheduled };
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const actor = await this.actor(ctx);
    const task = await this.view(ctx, actor, id);
    const [events, comments, results, extensions] = await Promise.all([
      ctx.tenantDb.taskEvent.findMany({ where: { taskId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      ctx.tenantDb.taskComment.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' } }),
      ctx.tenantDb.taskResult.findMany({ where: { taskId: id }, orderBy: { createdAt: 'desc' } }),
      ctx.tenantDb.taskExtensionRequest.findMany({ where: { taskId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const userIds = dedupe([
      ...events.map((e) => e.actorUserId ?? ''),
      ...comments.map((c) => c.authorUserId),
      ...results.flatMap((r) => [r.authorUserId, r.reviewedByUserId ?? '']),
      ...extensions.flatMap((x) => [x.requestedByUserId, x.decidedByUserId ?? '']),
    ]);
    const users = userIds.length ? await ctx.tenantDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nm = new Map(users.map((u) => [u.id, u.name]));
    const name = (id: string | null) => (id ? (nm.get(id) ?? 'کاربر حذف‌شده') : null);
    return {
      ...task,
      events: events.map((e) => ({ ...e, actorName: e.actorUserId ? name(e.actorUserId) : 'سیستم' })),
      comments: comments.map((c) => ({ ...c, authorName: name(c.authorUserId) })),
      results: results.map((r) => ({ ...r, authorName: name(r.authorUserId), reviewedByName: name(r.reviewedByUserId) })),
      extensionRequests: extensions.map((x) => ({ ...x, requestedByName: name(x.requestedByUserId), decidedByName: name(x.decidedByUserId) })),
    };
  }

  // ── ثبت رویداد/اعلان ──────────────────────────────────────────────────

  private async record(
    db: TenantPrismaClient,
    taskId: string,
    type: string,
    actorUserId: string | null,
    extra: { from?: TaskStatusValue | null; to?: TaskStatusValue | null; note?: string | null; meta?: Record<string, unknown> } = {},
  ) {
    await db.taskEvent.create({
      data: {
        taskId,
        type,
        actorUserId,
        fromStatus: extra.from ?? null,
        toStatus: extra.to ?? null,
        note: extra.note ?? null,
        meta: (extra.meta as never) ?? undefined,
      },
    });
  }

  async notifyUsers(db: TenantPrismaClient, userIds: string[], exceptUserId: string | null, n: { type: string; title: string; body?: string; taskId: string }) {
    for (const userId of dedupe(userIds)) {
      if (userId === exceptUserId) continue;
      await this.notifications.notify(db, { userId, type: n.type, title: n.title, body: n.body, link: taskLink(n.taskId) });
    }
  }

  private async assertUsersExist(ctx: TenantRequestContext, ids: string[]) {
    if (ids.length === 0) return;
    const found = await ctx.tenantDb.user.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('کاربر انتخاب‌شده برای ارجاع یافت نشد');
  }

  /** انتقال وضعیت با قفل خوش‌بینانه: اگر همزمان کسی وضعیت را عوض کرده باشد ۴۰۹ می‌دهد. */
  private async transition(
    db: TenantPrismaClient,
    task: Pick<TaskRow, 'id' | 'status' | 'expiredFrom'>,
    action: TaskAction,
    actorUserId: string | null,
    eventType: string,
    data: Record<string, unknown> = {},
    note?: string | null,
    meta?: Record<string, unknown>,
  ): Promise<TaskStatusValue> {
    const from = task.status as TaskStatusValue;
    let to: TaskStatusValue;
    try {
      to = nextStatus(from, action, { expiredFrom: task.expiredFrom as TaskStatusValue | null });
    } catch (e) {
      if (e instanceof TaskTransitionError) throw new BadRequestException('این کار در وضعیت فعلی وظیفه امکان‌پذیر نیست');
      throw e;
    }
    const res = await db.task.updateMany({
      where: { id: task.id, status: task.status },
      data: { status: to, ...(to !== 'EXPIRED' ? { expiredFrom: null } : {}), ...data } as never,
    });
    if (res.count === 0) throw new ConflictException('وضعیت وظیفه همین الان تغییر کرد؛ صفحه را تازه کنید');
    await this.record(db, task.id, eventType, actorUserId, { from, to, note, meta });
    return to;
  }

  // ── ایجاد ─────────────────────────────────────────────────────────────

  async create(ctx: TenantRequestContext, dto: CreateTaskDto) {
    await this.permissions.assertCreate(ctx, 'tasks');
    const me = await resolveTenantUserId(ctx);
    const now = new Date();

    let assigneeIds = dedupe(dto.assigneeIds ?? (dto.assignedUserId ? [dto.assignedUserId] : []));
    if (assigneeIds.length === 0 && me) assigneeIds = [me];
    await this.assertUsersExist(ctx, assigneeIds);

    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
    if (startAt && dueAt && startAt > dueAt) throw new BadRequestException('زمان شروع نمی‌تواند بعد از موعد باشد');
    if (sendAt && dueAt && sendAt > dueAt) throw new BadRequestException('زمان ارسال نمی‌تواند بعد از موعد باشد');
    const reminders = dedupe((dto.reminderOffsetsMin ?? []).map(String)).map(Number);
    if (reminders.length && !dueAt) throw new BadRequestException('برای یادآوری باید موعد تعیین شود');
    const recurrence = dto.recurrence ?? 'NONE';
    const interval = dto.recurrenceInterval ?? 1;
    const scheduled = !!sendAt && sendAt.getTime() > now.getTime();
    const recurBase = startAt ?? now;
    const nextRecurAt = recurrence === 'NONE' ? null : nextOccurrence(recurBase, recurrence, interval);

    const task = await ctx.tenantDb.task.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || undefined,
        dueAt: dueAt ?? undefined,
        startAt: startAt ?? undefined,
        sendAt: sendAt ?? undefined,
        isPublished: !scheduled,
        publishedAt: scheduled ? null : now,
        priority: dto.priority ?? 'NORMAL',
        assignedUserId: assigneeIds[0] ?? null,
        createdByUserId: me,
        relatedModule: dto.relatedModule,
        relatedEntityId: dto.relatedEntityId,
        reminderOffsetsMin: reminders,
        recurrence,
        recurrenceInterval: interval,
        recurrenceEndAt: dto.recurrenceEndAt ? new Date(dto.recurrenceEndAt) : undefined,
        nextRecurAt,
        tags: dto.tags?.map((t) => t.trim()).filter(Boolean) ?? [],
        notes: dto.notes?.trim() || undefined,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        events: {
          create: [
            { type: 'created', actorUserId: me, toStatus: 'NEW', createdAt: now },
            scheduled
              ? { type: 'scheduled', actorUserId: me, meta: { sendAt: sendAt!.toISOString() }, createdAt: new Date(now.getTime() + 1) }
              : { type: 'sent', actorUserId: me, createdAt: new Date(now.getTime() + 1) },
          ],
        },
        checklist: dto.checklist?.length
          ? { create: dto.checklist.filter((t) => t.trim()).map((text, order) => ({ text: text.trim(), order })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });

    if (dto.attachments?.length) {
      await ctx.tenantDb.attachment.createMany({
        data: dto.attachments.map((f) => ({ entityType: 'Task', entityId: task.id, title: f.title, fileUrl: f.fileUrl, createdByUserId: me })),
      });
    }
    await ctx.tenantDb.activityLog.create({ data: { userId: me, action: 'task.created', entityType: 'Task', entityId: task.id } });
    await this.webhooks.dispatch(ctx.tenantId, 'task.created', { id: task.id, title: task.title, priority: task.priority });
    if (!scheduled) await this.notifyAssigned(ctx.tenantDb, task as unknown as TaskRow, assigneeIds, me);

    const matrix = await this.permissions.getEffective(ctx, 'tasks');
    return this.view(ctx, { userId: me, manager: matrix.canViewAll }, task.id);
  }

  private async notifyAssigned(db: TenantPrismaClient, task: Pick<TaskRow, 'id' | 'title' | 'relatedModule'>, assigneeIds: string[], except: string | null) {
    await this.notifyUsers(db, assigneeIds, except, {
      type: 'task.assigned',
      title: `یک وظیفه به شما ارجاع شد: «${task.title}»`,
      body: task.relatedModule ? `مرتبط با ${task.relatedModule}` : 'برای پیگیری',
      taskId: task.id,
    });
  }

  /** انتشارِ وظیفه‌ی زمان‌بندی‌شده (cron) — از این لحظه برای ارجاع‌گیرنده قابل‌دیدن و اعلان‌رسانی می‌شود. */
  async publishScheduled(db: TenantPrismaClient, taskId: string, now: Date = new Date()): Promise<boolean> {
    const res = await db.task.updateMany({ where: { id: taskId, isPublished: false }, data: { isPublished: true, publishedAt: now } });
    if (res.count === 0) return false;
    const task = await db.task.findUnique({ where: { id: taskId }, include: { assignees: true } });
    if (!task) return false;
    await this.record(db, taskId, 'sent', null, { note: 'ارسال زمان‌بندی‌شده' });
    await this.notifyAssigned(db, task, this.assigneeIdsOf(task as unknown as TaskRow), task.createdByUserId);
    return true;
  }

  // ── ویرایش ────────────────────────────────────────────────────────────

  async update(ctx: TenantRequestContext, id: string, dto: UpdateTaskDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    const role = this.roleOf(task, actor);
    this.assertManage(role);
    if (task.status === 'APPROVED' || task.status === 'CANCELLED') throw new BadRequestException('وظیفه‌ی بسته‌شده قابل ویرایش نیست');

    const data: Record<string, unknown> = {};
    const changes: string[] = [];
    if (dto.title !== undefined && dto.title.trim() !== task.title) {
      data.title = dto.title.trim();
      changes.push('title');
    }
    if (dto.priority !== undefined && dto.priority !== task.priority) {
      data.priority = dto.priority;
      changes.push('priority');
    }
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
      changes.push('description');
    }
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.tags !== undefined) data.tags = dto.tags.map((t) => t.trim()).filter(Boolean);
    if (dto.startAt !== undefined) data.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.reminderOffsetsMin !== undefined) {
      data.reminderOffsetsMin = dedupe(dto.reminderOffsetsMin.map(String)).map(Number);
      data.remindersSentMin = [];
    }
    if (dto.sendAt !== undefined) {
      if (task.isPublished) throw new BadRequestException('وظیفه قبلاً ارسال شده و زمان ارسال قابل تغییر نیست');
      data.sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
      // اگر زمان ارسال حذف یا گذشته شد: همین الان منتشر می‌شود
      if (!dto.sendAt || new Date(dto.sendAt).getTime() <= Date.now()) {
        data.sendAt = null;
      }
    }
    if (dto.recurrence !== undefined || dto.recurrenceInterval !== undefined || dto.recurrenceEndAt !== undefined) {
      const type = dto.recurrence ?? (task.recurrence as 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY');
      const interval = dto.recurrenceInterval ?? task.recurrenceInterval;
      data.recurrence = type;
      data.recurrenceInterval = interval;
      if (dto.recurrenceEndAt !== undefined) data.recurrenceEndAt = dto.recurrenceEndAt ? new Date(dto.recurrenceEndAt) : null;
      data.nextRecurAt = type === 'NONE' ? null : (task.nextRecurAt ?? nextOccurrence(task.startAt ?? new Date(), type, interval));
    }

    let resume = false;
    const newDue = dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null;
    const dueChanged = newDue !== undefined && (task.dueAt?.getTime() ?? null) !== (newDue?.getTime() ?? null);
    if (dueChanged) {
      data.dueAt = newDue;
      data.remindersSentMin = [];
      data.overdueNotifiedAt = null;
      resume = task.status === 'EXPIRED' && (!newDue || newDue.getTime() > Date.now());
    }
    const finalDue = dueChanged ? newDue : task.dueAt;
    const finalStart = (data.startAt as Date | null | undefined) === undefined ? task.startAt : (data.startAt as Date | null);
    if (finalStart && finalDue && finalStart > finalDue) throw new BadRequestException('زمان شروع نمی‌تواند بعد از موعد باشد');
    const finalReminders = (data.reminderOffsetsMin as number[] | undefined) ?? task.reminderOffsetsMin;
    if (finalReminders.length && !finalDue) throw new BadRequestException('برای یادآوری باید موعد تعیین شود');

    if (Object.keys(data).length) await ctx.tenantDb.task.update({ where: { id }, data: data as never });
    if (resume) await this.transition(ctx.tenantDb, task, 'RESUME', actor.userId, 'resumed', {}, 'تمدید موعد');
    if (dueChanged) {
      await this.record(ctx.tenantDb, id, 'deadline_changed', actor.userId, {
        meta: { from: task.dueAt?.toISOString() ?? null, to: newDue?.toISOString() ?? null },
      });
    }
    if (changes.length || data.startAt !== undefined || data.tags !== undefined || data.notes !== undefined || data.reminderOffsetsMin !== undefined || data.recurrence !== undefined) {
      await this.record(ctx.tenantDb, id, 'edited', actor.userId, { meta: { fields: changes } });
    }
    if (dto.assignedUserId !== undefined && dto.assignedUserId !== task.assignedUserId) {
      await this.reassignInternal(ctx, actor, await this.load(ctx, actor, id), [dto.assignedUserId], null);
    }
    if (dueChanged && task.isPublished) {
      await this.notifyUsers(ctx.tenantDb, this.assigneeIdsOf(task), actor.userId, {
        type: 'task.rescheduled',
        title: `موعد یک وظیفه تغییر کرد: «${(data.title as string) ?? task.title}»`,
        body: newDue ? 'سررسید جدید ثبت شد' : 'سررسید برداشته شد',
        taskId: id,
      });
    }
    return this.view(ctx, actor, id);
  }

  // ── اقدام‌های ارجاع‌گیرنده ─────────────────────────────────────────────

  /** مشاهده‌ی وظیفه توسط ارجاع‌گیرنده: seenAt همان نفر + NEW→SEEN. چندبار صدا زدن بی‌اثر است. */
  async markSeen(ctx: TenantRequestContext, id: string) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    const role = this.roleOf(task, actor);
    if (!role.assignee || !task.isPublished || !actor.userId) return this.view(ctx, actor, id);

    // وظیفه‌ی ساخته‌شده توسط ماژول‌های دیگر ممکن است فقط ستون قدیمی را داشته باشد؛ ردیف ارجاع را می‌سازیم.
    await ctx.tenantDb.taskAssignee.upsert({
      where: { taskId_userId: { taskId: id, userId: actor.userId } },
      create: { taskId: id, userId: actor.userId },
      update: {},
    });
    const first = await ctx.tenantDb.taskAssignee.updateMany({ where: { taskId: id, userId: actor.userId, seenAt: null }, data: { seenAt: new Date() } });
    if (first.count > 0) {
      const from = task.status as TaskStatusValue;
      if (canTransition(from, 'SEE')) {
        await this.transition(ctx.tenantDb, task, 'SEE', actor.userId, 'viewed');
        await this.notifyUsers(ctx.tenantDb, task.createdByUserId ? [task.createdByUserId] : [], actor.userId, {
          type: 'task.seen',
          title: `وظیفه «${task.title}» دیده شد`,
          taskId: id,
        });
      } else {
        await this.record(ctx.tenantDb, id, 'viewed', actor.userId);
      }
    }
    return this.view(ctx, actor, id);
  }

  async start(ctx: TenantRequestContext, id: string) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertAssignee(this.roleOf(task, actor));
    if (!task.isPublished) throw new NotFoundException('وظیفه یافت نشد');
    await this.transition(ctx.tenantDb, task, 'START', actor.userId, 'started', task.startedAt ? {} : { startedAt: new Date() });
    return this.view(ctx, actor, id);
  }

  async submitResult(ctx: TenantRequestContext, id: string, dto: SubmitResultDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertAssignee(this.roleOf(task, actor));
    const text = dto.text?.trim();
    if (!text && !dto.files?.length) throw new BadRequestException('متن نتیجه یا حداقل یک فایل/عکس لازم است');
    const now = new Date();
    const ids = this.assigneeIdsOf(task);
    const approval = requiresApproval(task.createdByUserId, ids);

    await this.transition(ctx.tenantDb, task, 'SUBMIT', actor.userId, 'result_submitted', { submittedAt: now, completedAt: now }, text ?? null);
    const result = await ctx.tenantDb.taskResult.create({ data: { taskId: id, authorUserId: actor.userId ?? '', text: text || null } });
    if (dto.files?.length) {
      await ctx.tenantDb.attachment.createMany({
        data: dto.files.map((f) => ({ entityType: 'TaskResult', entityId: result.id, title: f.title, fileUrl: f.fileUrl, createdByUserId: actor.userId })),
      });
    }
    if (!approval) {
      const fresh = await ctx.tenantDb.task.findUniqueOrThrow({ where: { id }, include: { assignees: true } });
      await this.transition(ctx.tenantDb, fresh as TaskRow, 'APPROVE', null, 'auto_approved', { approvedAt: now }, 'تأیید خودکار (وظیفه‌ی شخصی)');
      await ctx.tenantDb.taskResult.update({ where: { id: result.id }, data: { status: 'APPROVED', reviewedAt: now } });
    } else {
      await this.notifyUsers(ctx.tenantDb, task.createdByUserId ? [task.createdByUserId] : [], actor.userId, {
        type: 'task.result_submitted',
        title: `نتیجه‌ی وظیفه «${task.title}» ثبت شد و منتظر تأیید شماست`,
        body: text?.slice(0, 120),
        taskId: id,
      });
    }
    return this.view(ctx, actor, id);
  }

  async reportProblem(ctx: TenantRequestContext, id: string, dto: ProblemDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertAssignee(this.roleOf(task, actor));
    await this.transition(ctx.tenantDb, task, 'REPORT_PROBLEM', actor.userId, 'problem_reported', {}, dto.body.trim());
    const comment = await ctx.tenantDb.taskComment.create({ data: { taskId: id, authorUserId: actor.userId ?? '', body: dto.body.trim(), isProblem: true } });
    if (dto.files?.length) {
      await ctx.tenantDb.attachment.createMany({
        data: dto.files.map((f) => ({ entityType: 'TaskComment', entityId: comment.id, title: f.title, fileUrl: f.fileUrl, createdByUserId: actor.userId })),
      });
    }
    await this.notifyUsers(ctx.tenantDb, task.createdByUserId ? [task.createdByUserId] : [], actor.userId, {
      type: 'task.problem',
      title: `مشکل در وظیفه «${task.title}» گزارش شد`,
      body: dto.body.trim().slice(0, 120),
      taskId: id,
    });
    return this.view(ctx, actor, id);
  }

  async addComment(ctx: TenantRequestContext, id: string, dto: CommentDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    if (dto.parentId) {
      const parent = await ctx.tenantDb.taskComment.findFirst({ where: { id: dto.parentId, taskId: id }, select: { id: true } });
      if (!parent) throw new BadRequestException('نظر اصلی یافت نشد');
    }
    const comment = await ctx.tenantDb.taskComment.create({
      data: { taskId: id, parentId: dto.parentId ?? null, authorUserId: actor.userId ?? '', body: dto.body.trim() },
    });
    const role = this.roleOf(task, actor);
    const targets = role.assignee && !canManageTask(role) ? (task.createdByUserId ? [task.createdByUserId] : []) : this.assigneeIdsOf(task);
    if (task.isPublished) {
      await this.notifyUsers(ctx.tenantDb, targets, actor.userId, {
        type: 'task.comment',
        title: `پیام جدید در وظیفه «${task.title}»`,
        body: dto.body.trim().slice(0, 120),
        taskId: id,
      });
    }
    return comment;
  }

  // ── درخواست تمدید ─────────────────────────────────────────────────────

  async requestExtension(ctx: TenantRequestContext, id: string, dto: ExtensionRequestDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertAssignee(this.roleOf(task, actor));
    if (!(ACTIVE_STATUSES as string[]).includes(task.status)) throw new BadRequestException('برای این وضعیت درخواست تمدید ممکن نیست');
    const proposed = new Date(dto.proposedDueAt);
    if (proposed.getTime() <= Date.now()) throw new BadRequestException('موعد پیشنهادی باید در آینده باشد');
    if (task.dueAt && proposed.getTime() <= task.dueAt.getTime() && task.status !== 'EXPIRED') throw new BadRequestException('موعد پیشنهادی باید بعد از موعد فعلی باشد');
    const pending = await ctx.tenantDb.taskExtensionRequest.count({ where: { taskId: id, status: 'PENDING' } });
    if (pending > 0) throw new BadRequestException('یک درخواست تمدید در انتظار بررسی دارد');
    await ctx.tenantDb.taskExtensionRequest.create({
      data: { taskId: id, requestedByUserId: actor.userId ?? '', proposedDueAt: proposed, reason: dto.reason?.trim() || null },
    });
    await this.record(ctx.tenantDb, id, 'extension_requested', actor.userId, { note: dto.reason, meta: { proposedDueAt: proposed.toISOString() } });
    await this.notifyUsers(ctx.tenantDb, task.createdByUserId ? [task.createdByUserId] : [], actor.userId, {
      type: 'task.extension_requested',
      title: `درخواست تمدید موعد وظیفه «${task.title}»`,
      body: dto.reason?.slice(0, 120),
      taskId: id,
    });
    return this.view(ctx, actor, id);
  }

  async decideExtension(ctx: TenantRequestContext, id: string, requestId: string, approve: boolean, dto: ExtensionDecisionDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    const req = await ctx.tenantDb.taskExtensionRequest.findFirst({ where: { id: requestId, taskId: id } });
    if (!req) throw new NotFoundException('درخواست تمدید یافت نشد');
    if (req.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');
    const claimed = await ctx.tenantDb.taskExtensionRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedByUserId: actor.userId, decisionNote: dto.note?.trim() || null, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException('این درخواست همین الان بررسی شد');
    if (approve) {
      const due = dto.dueAt ? new Date(dto.dueAt) : req.proposedDueAt;
      await ctx.tenantDb.task.update({ where: { id }, data: { dueAt: due, remindersSentMin: [], overdueNotifiedAt: null } });
      if (task.status === 'EXPIRED' && due.getTime() > Date.now()) await this.transition(ctx.tenantDb, task, 'RESUME', actor.userId, 'resumed', {}, 'تمدید موعد');
      await this.record(ctx.tenantDb, id, 'extension_approved', actor.userId, { note: dto.note, meta: { dueAt: due.toISOString() } });
    } else {
      await this.record(ctx.tenantDb, id, 'extension_rejected', actor.userId, { note: dto.note });
    }
    await this.notifyUsers(ctx.tenantDb, [req.requestedByUserId], actor.userId, {
      type: approve ? 'task.extension_approved' : 'task.extension_rejected',
      title: approve ? `درخواست تمدید وظیفه «${task.title}» تأیید شد` : `درخواست تمدید وظیفه «${task.title}» رد شد`,
      body: dto.note?.slice(0, 120),
      taskId: id,
    });
    return this.view(ctx, actor, id);
  }

  // ── اقدام‌های سازنده/مدیر ──────────────────────────────────────────────

  async approve(ctx: TenantRequestContext, id: string, dto: NoteDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    const now = new Date();
    await this.transition(ctx.tenantDb, task, 'APPROVE', actor.userId, 'approved', { approvedAt: now, approvedByUserId: actor.userId }, dto.note);
    await this.reviewLatestResult(ctx.tenantDb, id, 'APPROVED', actor.userId, dto.note);
    await this.notifyUsers(ctx.tenantDb, this.assigneeIdsOf(task), actor.userId, {
      type: 'task.approved',
      title: `نتیجه‌ی وظیفه «${task.title}» تأیید شد`,
      body: dto.note?.slice(0, 120),
      taskId: id,
    });
    return this.view(ctx, actor, id);
  }

  async returnForFix(ctx: TenantRequestContext, id: string, dto: RequiredNoteDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    await this.transition(ctx.tenantDb, task, 'RETURN', actor.userId, 'returned', { completedAt: null, submittedAt: null }, dto.note.trim());
    await this.reviewLatestResult(ctx.tenantDb, id, 'RETURNED', actor.userId, dto.note.trim());
    await this.notifyUsers(ctx.tenantDb, this.assigneeIdsOf(task), actor.userId, {
      type: 'task.returned',
      title: `وظیفه «${task.title}» برای اصلاح برگشت خورد`,
      body: dto.note.trim().slice(0, 120),
      taskId: id,
    });
    return this.view(ctx, actor, id);
  }

  private async reviewLatestResult(db: TenantPrismaClient, taskId: string, status: 'APPROVED' | 'RETURNED', reviewerId: string | null, note?: string | null) {
    const latest = await db.taskResult.findFirst({ where: { taskId, status: 'SUBMITTED' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!latest) return;
    await db.taskResult.update({ where: { id: latest.id }, data: { status, reviewNote: note?.trim() || null, reviewedByUserId: reviewerId, reviewedAt: new Date() } });
  }

  async resolveProblem(ctx: TenantRequestContext, id: string, dto: ResolveProblemDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    const due = dto.dueAt ? new Date(dto.dueAt) : null;
    await this.transition(
      ctx.tenantDb,
      task,
      'RESOLVE_PROBLEM',
      actor.userId,
      'problem_resolved',
      due ? { dueAt: due, remindersSentMin: [], overdueNotifiedAt: null } : {},
      dto.note,
      due ? { dueAt: due.toISOString() } : undefined,
    );
    await this.notifyUsers(ctx.tenantDb, this.assigneeIdsOf(task), actor.userId, {
      type: 'task.problem_resolved',
      title: `مشکل وظیفه «${task.title}» بررسی شد؛ ادامه دهید`,
      body: dto.note?.slice(0, 120),
      taskId: id,
    });
    return this.view(ctx, actor, id);
  }

  async reassign(ctx: TenantRequestContext, id: string, dto: ReassignDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    const ids = dedupe(dto.assigneeIds);
    if (ids.length === 0) throw new BadRequestException('حداقل یک ارجاع‌گیرنده لازم است');
    await this.reassignInternal(ctx, actor, task, ids, dto.note ?? null);
    return this.view(ctx, actor, id);
  }

  private async reassignInternal(ctx: TenantRequestContext, actor: TaskActor, task: TaskRow, ids: string[], note: string | null) {
    await this.assertUsersExist(ctx, ids);
    const before = this.assigneeIdsOf(task);
    const db = ctx.tenantDb;
    // ردیف‌های قبلیِ هنوز-معتبر را نگه می‌داریم (seenAt حفظ شود)؛ جدیدها اضافه، حذف‌شده‌ها پاک می‌شوند.
    await db.taskAssignee.deleteMany({ where: { taskId: task.id, userId: { notIn: ids } } });
    const kept = new Set(task.assignees.map((a) => a.userId));
    const fresh = ids.filter((u) => !kept.has(u));
    if (fresh.length) await db.taskAssignee.createMany({ data: fresh.map((userId) => ({ taskId: task.id, userId })), skipDuplicates: true });
    await db.taskAssignee.updateMany({ where: { taskId: task.id }, data: { seenAt: null } });
    await this.transition(db, task, 'REASSIGN', actor.userId, 'reassigned', { assignedUserId: ids[0], completedAt: null, submittedAt: null }, note, { from: before, to: ids });
    if (task.isPublished) {
      const added = ids.filter((u) => !before.includes(u));
      await this.notifyAssigned(db, task, added, actor.userId);
      await this.notifyUsers(db, before.filter((u) => !ids.includes(u)), actor.userId, {
        type: 'task.unassigned',
        title: `وظیفه «${task.title}» از شما برداشته شد`,
        taskId: task.id,
      });
    }
  }

  async cancel(ctx: TenantRequestContext, id: string, dto: NoteDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    await this.transition(ctx.tenantDb, task, 'CANCEL', actor.userId, 'cancelled', {}, dto.note);
    if (task.isPublished) {
      await this.notifyUsers(ctx.tenantDb, this.assigneeIdsOf(task), actor.userId, {
        type: 'task.cancelled',
        title: `وظیفه «${task.title}» لغو شد`,
        body: dto.note?.slice(0, 120),
        taskId: id,
      });
    }
    return this.view(ctx, actor, id);
  }

  async reopen(ctx: TenantRequestContext, id: string, dto: NoteDto) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    await this.transition(ctx.tenantDb, task, 'REOPEN', actor.userId, 'reopened', { completedAt: null, approvedAt: null, submittedAt: null, overdueNotifiedAt: null }, dto.note);
    return this.view(ctx, actor, id);
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await this.permissions.assertDelete(ctx, 'tasks');
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    this.assertManage(this.roleOf(task, actor));
    await ctx.tenantDb.task.delete({ where: { id } });
    return { success: true };
  }

  /**
   * سازگاری با دکمه‌ی قدیمیِ تیک (داشبورد/وظایف مرتبط): سازنده/مدیر وظیفه را مستقیم می‌بندد یا بازمی‌کند؛
   * ارجاع‌گیرنده‌ی عادی «نتیجه‌ی خالی» ثبت می‌کند (و در صورت نیاز تأیید منتظر می‌ماند).
   */
  async toggle(ctx: TenantRequestContext, id: string) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    const role = this.roleOf(task, actor);
    const finished = task.status === 'APPROVED' || task.status === 'DONE';
    if (canManageTask(role)) {
      if (finished) await this.transition(ctx.tenantDb, task, 'REOPEN', actor.userId, 'reopened', { completedAt: null, approvedAt: null, submittedAt: null }).catch(async () => {
        // DONE (منتظر تأیید) → برگشت برای اصلاح
        await this.transition(ctx.tenantDb, task, 'RETURN', actor.userId, 'returned', { completedAt: null, submittedAt: null });
      });
      else {
        const now = new Date();
        const status = task.status as TaskStatusValue;
        if (status === 'CANCELLED') throw new BadRequestException('وظیفه‌ی لغوشده قابل تکمیل نیست');
        const res = await ctx.tenantDb.task.updateMany({ where: { id, status: task.status }, data: { status: 'APPROVED', completedAt: now, approvedAt: now, approvedByUserId: actor.userId, submittedAt: now } });
        if (res.count === 0) throw new ConflictException('وضعیت وظیفه همین الان تغییر کرد؛ صفحه را تازه کنید');
        await this.record(ctx.tenantDb, id, 'approved', actor.userId, { from: status, to: 'APPROVED', note: 'تکمیل مستقیم' });
      }
    } else if (role.assignee) {
      if (finished) throw new ForbiddenException('فقط سازنده یا مدیر می‌تواند وظیفه‌ی انجام‌شده را بازگرداند');
      await this.submitResult(ctx, id, { text: 'انجام شد' });
    } else {
      throw new ForbiddenException('اجازه‌ی این کار را ندارید');
    }
    return this.view(ctx, actor, id);
  }

  // ── checklist (قدیمی؛ فقط سازنده/مدیر/ارجاع‌گیرنده) ─────────────────────

  async assertChecklistAccess(ctx: TenantRequestContext, id: string) {
    const actor = await this.actor(ctx);
    const task = await this.load(ctx, actor, id);
    const role = this.roleOf(task, actor);
    if (!canManageTask(role) && !role.assignee) throw new ForbiddenException('اجازه‌ی این کار را ندارید');
    return task;
  }

  isAssignee(task: Pick<TaskRow, 'assignedUserId' | 'assignees'>, userId: string | null) {
    return isTaskAssignee(task, userId);
  }

  readonly workingStatuses = WORKING_STATUSES;
}
