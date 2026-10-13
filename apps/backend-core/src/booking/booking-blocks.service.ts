import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import {
  DEFAULT_BLOCK_PREFERENCES,
  TASK_ACTIVE_STATUSES,
  applyPreferences,
  expandManualBlock,
  leaveToBusyRange,
  mentoringSessionToBusyRange,
  overlaps,
  taskToBusyRange,
  type BlockPreferences,
  type BusyRange,
} from './booking-blocks.js';
import { tehranParts } from './tehran-time.js';

const DAY_MS = 24 * 3_600_000;

/**
 * بازه‌های مشغولِ هر کارشناس برای محاسبه‌ی وقت آزاد: بلوک‌های دستی + (بسته به تنظیمات کارشناس)
 * وظایف، جلسات مشاوره و مرخصی تأییدشده. برای هر منبع فقط «یک» کوئری دسته‌ایی برای همه‌ی کارشناسان.
 */
@Injectable()
export class BookingBlocksService {
  async loadPreferences(ctx: TenantRequestContext, userIds: string[]): Promise<Map<string, BlockPreferences>> {
    const rows = userIds.length
      ? await ctx.tenantDb.staffBookingPreference.findMany({ where: { userId: { in: userIds } } })
      : [];
    const map = new Map<string, BlockPreferences>();
    for (const r of rows) map.set(r.userId, { blockFromTasks: r.blockFromTasks, blockFromCalendar: r.blockFromCalendar, blockFromLeave: r.blockFromLeave });
    return map;
  }

  /** همه‌ی بازه‌های مشغول (با دلیل) که با [from, to) تداخل دارند. فیلتر تنظیمات هر کارشناس اعمال شده است. */
  async loadBusyRanges(ctx: TenantRequestContext, userIds: string[], from: Date, to: Date): Promise<BusyRange[]> {
    if (userIds.length === 0) return [];
    const prefs = await this.loadPreferences(ctx, userIds);
    const pref = (id: string) => prefs.get(id) ?? DEFAULT_BLOCK_PREFERENCES;
    const taskUsers = userIds.filter((id) => pref(id).blockFromTasks);
    const calUsers = userIds.filter((id) => pref(id).blockFromCalendar);
    const leaveUsers = userIds.filter((id) => pref(id).blockFromLeave);

    const fromKey = tehranParts(from).dateKey;
    const toKey = tehranParts(new Date(to.getTime() - 1)).dateKey;

    const [manual, assignees, sessions, leaves] = await Promise.all([
      ctx.tenantDb.staffTimeBlock.findMany({ where: { userId: { in: userIds }, startDate: { lte: toKey }, endDate: { gte: fromKey } } }),
      taskUsers.length
        ? ctx.tenantDb.taskAssignee.findMany({
            where: {
              userId: { in: taskUsers },
              task: { status: { in: [...TASK_ACTIVE_STATUSES] }, isPublished: true, startAt: { not: null, lt: to }, dueAt: { gt: from } },
            },
            select: { userId: true, task: { select: { number: true, status: true, isPublished: true, startAt: true, dueAt: true } } },
          })
        : Promise.resolve([]),
      calUsers.length
        ? ctx.tenantDb.mentoringSession.findMany({
            where: {
              status: 'SCHEDULED',
              appointmentId: null, // جلسه‌ی رزروشده از همین ماژول، خودش به‌صورت نوبت محاسبه می‌شود
              scheduledAt: { lt: to, gte: new Date(from.getTime() - DAY_MS) },
              engagement: { advisorUserId: { in: calUsers } },
            },
            select: { status: true, scheduledAt: true, durationMinutes: true, engagement: { select: { advisorUserId: true, title: true } } },
          })
        : Promise.resolve([]),
      leaveUsers.length
        ? ctx.tenantDb.leaveRequest.findMany({
            where: {
              status: 'APPROVED',
              employee: { userId: { in: leaveUsers } },
              startDate: { lt: new Date(to.getTime() + DAY_MS) },
              endDate: { gte: new Date(from.getTime() - DAY_MS) },
            },
            select: { status: true, startDate: true, endDate: true, employee: { select: { userId: true } } },
          })
        : Promise.resolve([]),
    ]);

    const out: BusyRange[] = [];
    for (const b of manual) out.push(...expandManualBlock(b, fromKey, toKey));
    for (const a of assignees) {
      const r = taskToBusyRange(a.task, a.userId);
      if (r) out.push(r);
    }
    for (const s of sessions) {
      const r = mentoringSessionToBusyRange({ ...s, engagementTitle: s.engagement.title }, s.engagement.advisorUserId);
      if (r) out.push(r);
    }
    for (const l of leaves) {
      if (!l.employee.userId) continue;
      const r = leaveToBusyRange(l, l.employee.userId);
      if (r) out.push(r);
    }
    return applyPreferences(out, prefs).filter((r) => overlaps(r.start, r.end, from, to));
  }
}
