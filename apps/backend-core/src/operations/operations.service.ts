import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { TasksService, type TaskActor } from '../tasks/tasks.service.js';
import { taskScopeWhere } from '../tasks/task-scope.js';
import { formatTaskCode } from '../tasks/task-number.js';
import { ACTIVE_STATUSES, FINISHED_STATUSES, type TaskStatusValue } from '../tasks/task-state.js';
import {
  buildCsv,
  buildTrend,
  clampDays,
  clampLimit,
  computeRangeStats,
  computeWorkload,
  counterFromStatuses,
  decodeCursor,
  eventLabel,
  parseRange,
  rankAttention,
  sortWorkload,
  startOfTehranDay,
  startOfTehranWeek,
  type AttentionDraft,
  type Priority,
  type StatusCounts,
  type WorkloadSort,
} from './operations-logic.js';

type Where = Record<string, unknown>;

/** سقف ردیف‌های خوانده‌شده برای تجمیع در حافظه (بازه‌ی حداکثر یک‌ساله). */
const ROW_CAP = 20_000;
const ATTENTION_PER_KIND = 60;

@Injectable()
export class OperationsService {
  constructor(private readonly tasks: TasksService) {}

  /** همان دامنه‌ی دید ماژول وظایف — منطق جدا نوشته نشده تا هرگز ضعیف‌تر نشود. */
  private async scope(ctx: TenantRequestContext): Promise<{ actor: TaskActor; where: Where }> {
    const actor = await this.tasks.actor(ctx);
    return { actor, where: taskScopeWhere(actor.manager, actor.userId) };
  }

  private async names(ctx: TenantRequestContext, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((i): i is string => !!i))];
    if (uniq.length === 0) return new Map();
    const users = await ctx.tenantDb.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  // ── ۱) نمای کلی ───────────────────────────────────────────────────────

  async overview(ctx: TenantRequestContext, fromRaw?: string, toRaw?: string) {
    const { actor, where } = await this.scope(ctx);
    const now = new Date();
    const range = parseRange(fromRaw, toRaw, now);
    const db = ctx.tenantDb;
    const published: Where = { isPublished: true };

    const [byStatus, overdue, scheduled, extensionPending, doneToday, doneWeek, createdInRange, finished] = await Promise.all([
      db.task.groupBy({ by: ['status'], where: { AND: [where, published] } as never, _count: { _all: true } }),
      db.task.count({ where: { AND: [where, published, { dueAt: { lt: now }, status: { in: ACTIVE_STATUSES } }] } as never }),
      db.task.count({ where: { AND: [where, { isPublished: false }] } as never }),
      db.taskExtensionRequest.count({ where: { status: 'PENDING', task: where } as never }),
      db.task.count({ where: { AND: [where, { status: { in: FINISHED_STATUSES }, completedAt: { gte: startOfTehranDay(now) } }] } as never }),
      db.task.count({ where: { AND: [where, { status: { in: FINISHED_STATUSES }, completedAt: { gte: startOfTehranWeek(now) } }] } as never }),
      db.task.count({ where: { AND: [where, published, { createdAt: { gte: range.from, lte: range.to }, status: { not: 'CANCELLED' } }] } as never }),
      db.task.findMany({
        where: { AND: [where, { status: { in: FINISHED_STATUSES }, completedAt: { gte: range.from, lte: range.to } }] } as never,
        select: { createdAt: true, completedAt: true, dueAt: true },
        take: ROW_CAP,
      }),
    ]);

    const counts: StatusCounts = {};
    for (const g of byStatus) counts[g.status as TaskStatusValue] = g._count._all;
    return {
      scope: actor.manager ? 'all' : 'own',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      counters: { ...counterFromStatuses(counts, { overdue, extensionPending, scheduled }), doneToday, doneThisWeek: doneWeek },
      stats: computeRangeStats(createdInRange, finished),
      generatedAt: now.toISOString(),
    };
  }

  // ── ۲) بار کاری ───────────────────────────────────────────────────────

  async workload(ctx: TenantRequestContext, q: { from?: string; to?: string; sort?: string; dir?: string }) {
    const { actor, where } = await this.scope(ctx);
    const now = new Date();
    const range = parseRange(q.from, q.to, now);
    const rows = await ctx.tenantDb.task.findMany({
      where: {
        AND: [
          where,
          { OR: [{ status: { in: [...ACTIVE_STATUSES, 'DONE'] } }, { status: { in: FINISHED_STATUSES }, completedAt: { gte: range.from, lte: range.to } }] },
        ],
      } as never,
      select: {
        status: true,
        dueAt: true,
        isPublished: true,
        createdAt: true,
        completedAt: true,
        assignedUserId: true,
        assignees: { select: { userId: true } },
      },
      take: ROW_CAP,
    });
    const wl = computeWorkload(
      rows.map((r) => ({
        status: r.status as TaskStatusValue,
        dueAt: r.dueAt,
        isPublished: r.isPublished,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        assigneeIds: [...new Set([...(r.assignedUserId ? [r.assignedUserId] : []), ...r.assignees.map((a) => a.userId)])],
      })),
      range,
      now,
      new Map(),
      actor.manager ? null : actor.userId,
    );
    const userIds = wl.map((w) => w.userId);
    // آخرین فعالیت هر نفر: یک groupBy برای همه (نه یک کوئری برای هر نفر)
    const [last, nm] = await Promise.all([
      userIds.length
        ? ctx.tenantDb.taskEvent.groupBy({ by: ['actorUserId'], where: { actorUserId: { in: userIds } }, _max: { createdAt: true } })
        : Promise.resolve([] as Array<{ actorUserId: string | null; _max: { createdAt: Date | null } }>),
      this.names(ctx, userIds),
    ]);
    const lastMap = new Map(last.filter((l) => l.actorUserId && l._max.createdAt).map((l) => [l.actorUserId as string, l._max.createdAt as Date]));
    const enriched = wl.map((w) => ({ ...w, name: nm.get(w.userId) ?? 'کاربر حذف‌شده', lastActivityAt: lastMap.get(w.userId) ?? null }));
    const sort = (['open', 'overdue', 'done', 'avg', 'last', 'name'].includes(q.sort ?? '') ? q.sort : 'open') as WorkloadSort;
    return {
      scope: actor.manager ? 'all' : 'own',
      currentUserId: actor.userId,
      rows: sortWorkload(enriched, sort, q.dir === 'asc' ? 'asc' : 'desc'),
    };
  }

  // ── ۳) نیازمند اقدام ──────────────────────────────────────────────────

  async attention(ctx: TenantRequestContext, unseenHoursRaw?: string) {
    const { actor, where } = await this.scope(ctx);
    const now = new Date();
    const unseenHours = Math.min(Math.max(Number(unseenHoursRaw) || 4, 1), 168);
    const db = ctx.tenantDb;
    // غیرمدیر: اقدام‌های مدیریتی فقط روی وظایفی که خودش ساخته؛ تأخیر فقط روی وظایف خودش.
    const mine: Where = actor.manager ? {} : { createdByUserId: actor.userId };
    const own: Where = actor.manager
      ? {}
      : { OR: [{ assignedUserId: actor.userId }, { assignees: { some: { userId: actor.userId } } }] };
    const sel = { id: true, number: true, title: true, priority: true, dueAt: true, assignedUserId: true, createdByUserId: true, status: true, submittedAt: true, updatedAt: true, createdAt: true, publishedAt: true, sendAt: true, assignees: { select: { userId: true } } } as const;
    const unseenBefore = new Date(now.getTime() - unseenHours * 3_600_000);

    const [approvals, problems, extensions, overdue, unseen, scheduled] = await Promise.all([
      db.task.findMany({ where: { AND: [where, mine, { status: 'DONE' }] } as never, select: sel, orderBy: { submittedAt: 'asc' }, take: ATTENTION_PER_KIND }),
      db.task.findMany({ where: { AND: [where, mine, { status: 'HAS_PROBLEM' }] } as never, select: sel, orderBy: { updatedAt: 'asc' }, take: ATTENTION_PER_KIND }),
      db.taskExtensionRequest.findMany({
        where: { status: 'PENDING', task: { AND: [where, mine] } } as never,
        select: { id: true, taskId: true, proposedDueAt: true, reason: true, createdAt: true, requestedByUserId: true, task: { select: sel } },
        orderBy: { createdAt: 'asc' },
        take: ATTENTION_PER_KIND,
      }),
      db.task.findMany({
        where: { AND: [where, own, { isPublished: true, dueAt: { lt: now }, status: { in: ACTIVE_STATUSES } }] } as never,
        select: sel,
        orderBy: { dueAt: 'asc' },
        take: ATTENTION_PER_KIND,
      }),
      actor.manager
        ? db.task.findMany({
            where: {
              AND: [where, { isPublished: true, status: { in: ['NEW', 'OPEN'] }, OR: [{ publishedAt: { lt: unseenBefore } }, { publishedAt: null, createdAt: { lt: unseenBefore } }] }],
            } as never,
            select: sel,
            orderBy: { createdAt: 'asc' },
            take: ATTENTION_PER_KIND,
          })
        : Promise.resolve([]),
      db.task.findMany({ where: { AND: [where, mine, { isPublished: false, status: { not: 'CANCELLED' } }] } as never, select: sel, orderBy: { sendAt: 'asc' }, take: ATTENTION_PER_KIND }),
    ]);

    // آخرین متن «گزارش مشکل» هر وظیفه — یک کوئری برای همه
    const problemIds = problems.map((p) => p.id);
    const problemComments = problemIds.length
      ? await db.taskComment.findMany({ where: { taskId: { in: problemIds }, isProblem: true }, orderBy: { createdAt: 'desc' }, select: { taskId: true, body: true, createdAt: true }, take: problemIds.length * 3 })
      : [];
    const latestProblem = new Map<string, string>();
    for (const c of problemComments) if (!latestProblem.has(c.taskId)) latestProblem.set(c.taskId, c.body);

    type TaskLite = (typeof approvals)[number];
    const drafts: Array<AttentionDraft & { task: TaskLite; detail?: string | null; extension?: { id: string; proposedDueAt: Date; reason: string | null; requestedByUserId: string } }> = [];
    const pri = (t: TaskLite) => t.priority as Priority;
    for (const t of approvals) drafts.push({ kind: 'approval', taskId: t.id, since: t.submittedAt ?? t.updatedAt, priority: pri(t), task: t });
    for (const t of problems) drafts.push({ kind: 'problem', taskId: t.id, since: t.updatedAt, priority: pri(t), task: t, detail: latestProblem.get(t.id) ?? null });
    for (const e of extensions) {
      drafts.push({
        kind: 'extension',
        taskId: e.taskId,
        extensionRequestId: e.id,
        since: e.createdAt,
        priority: pri(e.task),
        task: e.task,
        detail: e.reason,
        extension: { id: e.id, proposedDueAt: e.proposedDueAt, reason: e.reason, requestedByUserId: e.requestedByUserId },
      });
    }
    for (const t of overdue) drafts.push({ kind: 'overdue', taskId: t.id, since: t.dueAt ?? t.createdAt, priority: pri(t), task: t });
    for (const t of unseen) drafts.push({ kind: 'unseen', taskId: t.id, since: t.publishedAt ?? t.createdAt, priority: pri(t), task: t });
    for (const t of scheduled) drafts.push({ kind: 'scheduled', taskId: t.id, since: t.sendAt ?? t.createdAt, priority: pri(t), task: t });

    const ranked = rankAttention(drafts, now, 100);
    const prefix = await this.tasks.getPrefix(db);
    const nm = await this.names(
      ctx,
      ranked.flatMap((r) => [r.task.assignedUserId, ...r.task.assignees.map((a) => a.userId), r.extension?.requestedByUserId]),
    );
    return {
      scope: actor.manager ? 'all' : 'own',
      unseenHours,
      items: ranked.map((r) => {
        const ids = [...new Set([...(r.task.assignedUserId ? [r.task.assignedUserId] : []), ...r.task.assignees.map((a) => a.userId)])];
        return {
          kind: r.kind,
          taskId: r.taskId,
          code: formatTaskCode(prefix, r.task.number),
          title: r.task.title,
          priority: r.task.priority,
          status: r.task.status,
          dueAt: r.task.dueAt,
          since: r.since,
          ageHours: r.ageHours,
          score: r.score,
          detail: r.detail ?? null,
          assignees: ids.map((id) => ({ userId: id, name: nm.get(id) ?? 'کاربر حذف‌شده' })),
          extension: r.extension
            ? { id: r.extension.id, proposedDueAt: r.extension.proposedDueAt, reason: r.extension.reason, requestedByName: nm.get(r.extension.requestedByUserId) ?? 'کاربر حذف‌شده' }
            : null,
        };
      }),
    };
  }

  // ── ۴) فید فعالیت ─────────────────────────────────────────────────────

  async activity(ctx: TenantRequestContext, cursorRaw?: string, limitRaw?: string) {
    const { where } = await this.scope(ctx);
    const limit = clampLimit(limitRaw, 30, 100);
    const cursor = decodeCursor(cursorRaw);
    const events = await ctx.tenantDb.taskEvent.findMany({
      where: { task: where } as never,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, taskId: true, type: true, actorUserId: true, fromStatus: true, toStatus: true, note: true, createdAt: true, task: { select: { number: true, title: true } } },
    });
    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    const [prefix, nm] = await Promise.all([this.tasks.getPrefix(ctx.tenantDb), this.names(ctx, page.map((e) => e.actorUserId))]);
    return {
      items: page.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        code: formatTaskCode(prefix, e.task.number),
        taskTitle: e.task.title,
        type: e.type,
        label: eventLabel(e.type),
        actorUserId: e.actorUserId,
        actorName: e.actorUserId ? (nm.get(e.actorUserId) ?? 'کاربر حذف‌شده') : 'سیستم',
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // ── ۵) روند ───────────────────────────────────────────────────────────

  async trend(ctx: TenantRequestContext, daysRaw?: string) {
    const { actor, where } = await this.scope(ctx);
    const now = new Date();
    const days = clampDays(daysRaw);
    const since = new Date(startOfTehranDay(now).getTime() - (days - 1) * 86_400_000);
    const rows = await ctx.tenantDb.task.findMany({
      where: { AND: [where, { OR: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }] }] } as never,
      select: { createdAt: true, completedAt: true, priority: true, status: true },
      take: ROW_CAP,
    });
    return {
      scope: actor.manager ? 'all' : 'own',
      days,
      ...buildTrend(
        rows.map((r) => ({ createdAt: r.createdAt, completedAt: r.completedAt, priority: r.priority as Priority, status: r.status as TaskStatusValue })),
        days,
        now,
      ),
    };
  }

  // ── ۶) خروجی CSV ──────────────────────────────────────────────────────

  async exportCsv(ctx: TenantRequestContext, fromRaw?: string, toRaw?: string): Promise<string> {
    const { where } = await this.scope(ctx);
    const now = new Date();
    const range = parseRange(fromRaw, toRaw, now);
    const rows = await ctx.tenantDb.task.findMany({
      where: { AND: [where, { createdAt: { gte: range.from, lte: range.to } }] } as never,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: { number: true, title: true, status: true, priority: true, createdAt: true, dueAt: true, completedAt: true, createdByUserId: true, assignedUserId: true, assignees: { select: { userId: true } } },
    });
    const [prefix, nm] = await Promise.all([
      this.tasks.getPrefix(ctx.tenantDb),
      this.names(ctx, rows.flatMap((r) => [r.createdByUserId, r.assignedUserId, ...r.assignees.map((a) => a.userId)])),
    ]);
    return buildCsv(
      rows.map((r) => ({
        code: formatTaskCode(prefix, r.number),
        title: r.title,
        status: r.status,
        priority: r.priority,
        assignees: [...new Set([...(r.assignedUserId ? [r.assignedUserId] : []), ...r.assignees.map((a) => a.userId)])].map((id) => nm.get(id) ?? 'کاربر حذف‌شده'),
        creator: r.createdByUserId ? (nm.get(r.createdByUserId) ?? 'کاربر حذف‌شده') : null,
        createdAt: r.createdAt,
        dueAt: r.dueAt,
        completedAt: r.completedAt,
      })),
      now,
    );
  }
}
