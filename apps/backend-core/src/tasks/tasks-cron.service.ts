import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { selectDueForPublish, selectOverdueToNotify, selectRecurringDue, selectReminders, selectToExpire, humanizeMinutes } from './task-cron-logic.js';
import { nextOccurrence, shiftDates, type RecurrenceType } from './task-recurrence.js';
import { ACTIVE_STATUSES, WORKING_STATUSES, type TaskStatusValue } from './task-state.js';
import { TasksService } from './tasks.service.js';

/**
 * کارهای زمان‌بندی‌شده‌ی وظایف (هر ۵ دقیقه، روی همه‌ی تننت‌های فعال):
 *  ۱) انتشار وظایف زمان‌بندی‌شده  ۲) یادآوری پیش از موعد  ۳) اعلان تأخیر + انقضا  ۴) ساخت نمونه‌ی بعدی وظایف تکرارشونده.
 * (مدل قدیمی Reminder همچنان بدون پردازشگر است؛ یادآوری وظایف از ستون‌های reminderOffsetsMin/remindersSentMin می‌آید.)
 * «وظایف» ماژول هسته‌ای است: فقط تننت‌هایی که صریحاً DISABLED کرده‌اند حذف می‌شوند.
 */
@Injectable()
export class TasksCronService {
  private readonly logger = new Logger('TasksCronService');
  private running = false;

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tasks: TasksService,
  ) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const module = await this.controlDb.moduleDefinition.findUnique({ where: { code: 'tasks' } });
      if (!module) return;
      const tenants = await this.controlDb.tenant.findMany({
        where: {
          status: 'ACTIVE',
          ...(module.isCore
            ? { tenantModules: { none: { moduleId: module.id, status: 'DISABLED' } } }
            : { tenantModules: { some: { moduleId: module.id, status: { in: ['INSTALLED', 'TRIAL'] } } } }),
        },
      });
      for (const tenant of tenants) {
        try {
          const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
          await this.processTenant(db);
        } catch (err) {
          this.logger.error(`Tasks cron failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** برای تست/اجرای دستی. هر مرحله مستقل است تا خطای یکی بقیه را متوقف نکند. */
  async processTenant(db: TenantPrismaClient, now: Date = new Date()) {
    const out = { published: 0, reminded: 0, expired: 0, overdueNotified: 0, recurred: 0 };
    for (const [name, step] of [
      ['publish', async () => (out.published = await this.publishDue(db, now))],
      ['remind', async () => (out.reminded = await this.sendReminders(db, now))],
      ['overdue', async () => Object.assign(out, await this.handleOverdue(db, now))],
      ['recur', async () => (out.recurred = await this.spawnRecurring(db, now))],
    ] as const) {
      try {
        await step();
      } catch (err) {
        this.logger.error(`Tasks cron step "${name}" failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  async publishDue(db: TenantPrismaClient, now: Date): Promise<number> {
    const candidates = await db.task.findMany({ where: { isPublished: false, sendAt: { lte: now } }, include: { assignees: true }, take: 200 });
    let n = 0;
    for (const t of selectDueForPublish(candidates as never[], now) as Array<{ id: string }>) {
      if (await this.tasks.publishScheduled(db, t.id, now)) n++;
    }
    return n;
  }

  async sendReminders(db: TenantPrismaClient, now: Date): Promise<number> {
    const candidates = await db.task.findMany({
      where: { isPublished: true, status: { in: WORKING_STATUSES as never[] }, dueAt: { gt: now }, reminderOffsetsMin: { isEmpty: false } },
      include: { assignees: true },
      take: 500,
    });
    const due = selectReminders(candidates as never[], now) as unknown as Array<{ task: (typeof candidates)[number]; fire: number; mark: number[] }>;
    let n = 0;
    for (const { task, fire, mark } of due) {
      await db.task.update({ where: { id: task.id }, data: { remindersSentMin: [...new Set([...task.remindersSentMin, ...mark])] } });
      const ids = [...new Set([...(task.assignedUserId ? [task.assignedUserId] : []), ...task.assignees.map((a) => a.userId)])];
      await this.tasks.notifyUsers(db, ids, null, {
        type: 'task.reminder',
        title: `یادآوری: «${task.title}» تا ${humanizeMinutes(fire)} دیگر سررسید می‌شود`,
        taskId: task.id,
      });
      await db.taskEvent.create({ data: { taskId: task.id, type: 'reminder_sent', meta: { offsetMin: fire } } });
      n++;
    }
    return n;
  }

  /** وظایف باز با موعد گذشته: اعلان تأخیر (یک‌بار) + انقضای NEW/SEEN/IN_PROGRESS/RETURNED_FOR_FIX. */
  async handleOverdue(db: TenantPrismaClient, now: Date): Promise<{ expired: number; overdueNotified: number }> {
    const candidates = await db.task.findMany({
      where: { isPublished: true, status: { in: ACTIVE_STATUSES as never[] }, dueAt: { lt: now }, overdueNotifiedAt: null },
      include: { assignees: true },
      take: 500,
    });
    const expireIds = new Set((selectToExpire(candidates as never[], now) as Array<{ id: string }>).map((t) => t.id));
    let expired = 0;
    let notified = 0;
    for (const task of selectOverdueToNotify(candidates as never[], now) as unknown as typeof candidates) {
      const claimed = await db.task.updateMany({
        where: { id: task.id, status: task.status, overdueNotifiedAt: null },
        data: {
          overdueNotifiedAt: now,
          ...(expireIds.has(task.id) ? { status: 'EXPIRED', expiredFrom: task.status === 'OPEN' ? 'NEW' : task.status } : {}),
        },
      });
      if (claimed.count === 0) continue;
      if (expireIds.has(task.id)) {
        expired++;
        await db.taskEvent.create({ data: { taskId: task.id, type: 'expired', fromStatus: task.status, toStatus: 'EXPIRED' } });
      } else {
        await db.taskEvent.create({ data: { taskId: task.id, type: 'overdue_notified', fromStatus: task.status, toStatus: task.status as TaskStatusValue } });
      }
      const ids = [
        ...(task.assignedUserId ? [task.assignedUserId] : []),
        ...task.assignees.map((a) => a.userId),
        ...(task.createdByUserId ? [task.createdByUserId] : []),
      ];
      await this.tasks.notifyUsers(db, ids, null, {
        type: 'task.overdue',
        title: `موعد وظیفه «${task.title}» گذشت`,
        body: 'با مدیر هماهنگ کنید یا درخواست تمدید ثبت کنید',
        taskId: task.id,
      });
      notified++;
    }
    return { expired, overdueNotified: notified };
  }

  /**
   * ساخت نمونه‌ی بعدی: قالب (وظیفه‌ی اصلی با recurrence) نگه‌دار زمان nextRecurAt است؛ نمونه‌ی جدید با همان ارجاع‌گیرندگان
   * و موعد/شروعِ جابه‌جا‌شده ساخته می‌شود (recurrence=NONE، با recurrenceParentId). اگر سرور مدتی نبوده فقط یک نمونه می‌سازد.
   */
  async spawnRecurring(db: TenantPrismaClient, now: Date): Promise<number> {
    const candidates = await db.task.findMany({
      where: { isPublished: true, recurrence: { not: 'NONE' }, nextRecurAt: { lte: now }, status: { not: 'CANCELLED' } },
      include: { assignees: true },
      take: 100,
    });
    let n = 0;
    for (const t of selectRecurringDue(candidates as never[], now) as unknown as typeof candidates) {
      const anchor = t.startAt ?? t.createdAt;
      const at = t.nextRecurAt!;
      const type = t.recurrence as RecurrenceType;
      let next = nextOccurrence(at, type, t.recurrenceInterval);
      while (next && next.getTime() <= now.getTime()) next = nextOccurrence(next, type, t.recurrenceInterval);
      const ended = !!t.recurrenceEndAt && at.getTime() > t.recurrenceEndAt.getTime();
      const nextRecurAt = ended || (t.recurrenceEndAt && next && next.getTime() > t.recurrenceEndAt.getTime()) ? null : next;
      // قفل: فقط اگر کسی دیگر همین سررسید را مصرف نکرده
      const claimed = await db.task.updateMany({
        where: { id: t.id, nextRecurAt: t.nextRecurAt },
        data: nextRecurAt ? { nextRecurAt } : { nextRecurAt: null, recurrence: 'NONE' },
      });
      if (claimed.count === 0 || ended) continue;
      const dates = shiftDates({ startAt: t.startAt, dueAt: t.dueAt }, anchor, at);
      const ids = [...new Set([...(t.assignedUserId ? [t.assignedUserId] : []), ...t.assignees.map((a) => a.userId)])];
      const spawned = await db.task.create({
        data: {
          title: t.title,
          description: t.description,
          priority: t.priority,
          relatedModule: t.relatedModule,
          relatedEntityId: t.relatedEntityId,
          createdByUserId: t.createdByUserId,
          assignedUserId: ids[0] ?? null,
          startAt: dates.startAt,
          dueAt: dates.dueAt,
          reminderOffsetsMin: t.reminderOffsetsMin,
          notes: t.notes,
          tags: t.tags,
          isPublished: true,
          publishedAt: now,
          recurrenceParentId: t.recurrenceParentId ?? t.id,
          assignees: { create: ids.map((userId) => ({ userId })) },
          events: {
            create: [
              { type: 'created', actorUserId: t.createdByUserId, toStatus: 'NEW', note: 'نمونه‌ی تکرارشونده' },
              { type: 'sent', createdAt: new Date(now.getTime() + 1) },
            ],
          },
        },
      });
      await db.taskEvent.create({ data: { taskId: t.id, type: 'recurred', meta: { spawnedTaskId: spawned.id } } });
      await this.tasks.notifyUsers(db, ids, t.createdByUserId, {
        type: 'task.assigned',
        title: `وظیفه‌ی تکرارشونده: «${t.title}»`,
        body: 'نمونه‌ی جدید برای پیگیری',
        taskId: spawned.id,
      });
      n++;
    }
    return n;
  }
}
