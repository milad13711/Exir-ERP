import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { REMINDER_DAILY_CAP, REMINDER_MAX_AGE_HOURS, selectDueReminders, type NotificationCategory } from './push-logic.js';

/**
 * یادآوری مجدد اعلان‌های مهمِ نخوانده (ارجاع/تأیید/وظیفه…): هر ۳۰ دقیقه برای همه‌ی تننت‌های فعال.
 * - فقط اگر کاربر روشن گذاشته باشد (پیش‌فرض روشن)، پس از N ساعت (پیش‌فرض ۴)، فقط در ساعات کاری تهران و بیرون از سکوت.
 * - idempotent: ادعای اتمیک `remindedAt IS NULL → now` قبل از ارسال؛ هر اعلان حداکثر یک‌بار یادآوری می‌شود، حتی با دو نمونه‌ی هم‌زمان کرون.
 * - سقف: برای هر کاربر در هر اجرا حداکثر ۱ پیام (تجمیعی) و در هر روز حداکثر REMINDER_DAILY_CAP یادآوری.
 */
@Injectable()
export class NotificationReminderService {
  private readonly logger = new Logger('NotificationReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepAllTenants(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        await this.sweepTenant(db);
      } catch (err) {
        this.logger.warn(`Notification reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** تعداد یادآوری ارسال‌شده را برمی‌گرداند (برای آزمون). */
  async sweepTenant(db: TenantPrismaClient, now = new Date()): Promise<number> {
    const minAge = new Date(now.getTime() - 3600_000); // کمترین تأخیر ممکن (۱ ساعت)؛ شرط دقیق هر کاربر در selectDueReminders
    const oldest = new Date(now.getTime() - REMINDER_MAX_AGE_HOURS * 3600_000);
    // صفحه‌بندی با نشانگر: ردیف‌های ردشده در selectDueReminders (هنوز زمانشان نرسیده / سقف روزانه) نباید ۱۰۰۰ ردیف اول را اشغال کنند و بقیه را گرسنه بگذارند
    const PAGE = 500;
    const MAX_PAGES = 20;
    const prefsCache = new Map<string, Awaited<ReturnType<typeof db.notificationPreference.findUnique>> | null>();
    const cappedUsers = new Set<string>();
    let cursorId: string | undefined;
    let sent = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await db.notification.findMany({
        where: {
          important: true,
          readAt: null,
          remindedAt: null,
          createdAt: { lte: minAge, gte: oldest },
          NOT: { type: { startsWith: 'notification.reminder' } },
          ...(cappedUsers.size ? { userId: { notIn: [...cappedUsers] } } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: PAGE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cursorId = rows[rows.length - 1].id;
      sent += await this.processPage(db, rows, now, prefsCache, cappedUsers);
      if (rows.length < PAGE) break;
    }
    return sent;
  }

  private async processPage(
    db: TenantPrismaClient,
    rows: Awaited<ReturnType<TenantPrismaClient['notification']['findMany']>>,
    now: Date,
    prefsCache: Map<string, unknown>,
    cappedUsers: Set<string>,
  ): Promise<number> {
    const byUser = new Map<string, typeof rows>();
    for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

    let sent = 0;
    for (const [userId, list] of byUser) {
      try {
        if (!prefsCache.has(userId)) prefsCache.set(userId, await db.notificationPreference.findUnique({ where: { userId } }).catch(() => null));
        const prefs = prefsCache.get(userId) as Parameters<typeof selectDueReminders>[1];
        const due = selectDueReminders(list, prefs, now);
        if (due.length === 0) continue;

        const dayStart = new Date(now.getTime() - 24 * 3600_000);
        const today = await db.notification.count({ where: { userId, type: 'notification.reminder', createdAt: { gte: dayStart } } });
        if (today >= REMINDER_DAILY_CAP) {
          cappedUsers.add(userId);
          continue;
        }

        // ادعای اتمیک: فقط ردیف‌هایی که همین نمونه موفق به علامت‌زدن‌شان شد یادآوری می‌شوند
        const claimed: typeof due = [];
        for (const n of due) {
          const r = await db.notification.updateMany({ where: { id: n.id, userId, remindedAt: null, readAt: null }, data: { remindedAt: now } });
          if (r.count === 1) claimed.push(n);
        }
        if (claimed.length === 0) continue;

        const first = list.find((x) => x.id === claimed[0].id)!;
        const single = claimed.length === 1;
        await this.notifications.notify(db, {
          userId,
          type: 'notification.reminder',
          category: (first.category as NotificationCategory | null) ?? undefined,
          title: single ? `یادآوری: ${first.title}` : `${claimed.length} مورد مهم هنوز منتظر اقدام شماست`,
          body: single ? (first.body ?? 'این مورد هنوز خوانده نشده است') : 'برای دیدن فهرست «نیاز به توجه شما» را باز کنید',
          link: single ? (first.link ?? '/notifications') : '/notifications?filter=important',
          entityType: single ? (first.entityType ?? undefined) : undefined,
          entityId: single ? (first.entityId ?? undefined) : undefined,
          important: false, // خودِ یادآوری دوباره یادآوری نمی‌شود
          tag: `reminder-${userId}`,
        });
        sent++;
      } catch (err) {
        this.logger.warn(`Reminder for ${userId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return sent;
  }
}
