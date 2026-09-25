import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { faDate } from '../common/persian.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { addDays, buildDailyReportBody, todayTehran } from './checklist-day.util.js';
import { rollPendingToNextDay } from './checklist-rollover.js';

/**
 * پایان‌روزِ خودکارِ چک‌لیست: اگر کاربر تا آخر وقت دکمه‌ی «ثبت گزارش روزانه» را نزده باشد، گزارش همان روز
 * (انجام‌شده‌ها و انجام‌نشده‌ها) خودکار در ماژول گزارش‌ها ثبت می‌شود و کارهای انجام‌نشده با برچسب «مانده از قبل»
 * به چک‌لیست فردا منتقل می‌شوند. هر (کاربر، روز) فقط یک‌بار بسته می‌شود (DailyChecklistDayClose).
 * دو اجرا: ۲۳:۵۵ به وقت تهران برای «امروز»، و ۰۰:۳۰ به‌عنوان جبران اگر سرور آن لحظه بالا نبوده برای «دیروز».
 */
@Injectable()
export class DailyChecklistCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DailyChecklistCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** بعد از هر بالا آمدن سرور، روزِ گذشته‌ای که هنوز بسته نشده (مثلاً گزارش دستی بدون انتقال) جبران می‌شود. */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.sweepAllTenants(false).catch(() => undefined), 30_000).unref();
  }

  @Cron('55 23 * * *', { timeZone: 'Asia/Tehran' })
  async closeToday(): Promise<void> {
    await this.sweepAllTenants(true);
  }

  @Cron('30 0 * * *', { timeZone: 'Asia/Tehran' })
  async closeYesterday(): Promise<void> {
    await this.sweepAllTenants(false);
  }

  private async sweepAllTenants(includeToday: boolean): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({
      where: {
        status: 'ACTIVE',
        tenantModules: { some: { status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'daily-checklist' } } },
      },
    });
    for (const tenant of tenants) {
      try {
        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        const closed = await this.closeDays(tenantDb, includeToday);
        if (closed > 0) this.logger.log(`Tenant ${tenant.slug}: closed ${closed} checklist day(s)`);
      } catch (err) {
        this.logger.error(`Daily checklist close failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** روزهای دیروز (و در صورت includeToday امروز) را برای همه‌ی پرسنلی که هنوز نبسته‌اند می‌بندد. برای تست عمومی است. */
  async closeDays(tenantDb: TenantPrismaClient, includeToday: boolean, now: Date = new Date()): Promise<number> {
    const today = todayTehran(now);
    const from = addDays(today, -1);
    const to = includeToday ? today : addDays(today, -1);

    const groups = await tenantDb.dailyChecklistItem.groupBy({
      by: ['userId', 'date'],
      where: { date: { gte: from, lte: to } },
    });

    let closed = 0;
    for (const g of groups) {
      const marker = await tenantDb.dailyChecklistDayClose.findUnique({ where: { userId_date: { userId: g.userId, date: g.date } } });
      if (marker?.rolledOver) continue;
      await this.closeOne(tenantDb, g.userId, g.date, marker?.reportId ?? null);
      closed += 1;
    }
    return closed;
  }

  private async closeOne(tenantDb: TenantPrismaClient, userId: string, date: Date, existingReportId: string | null): Promise<void> {
    const items = await tenantDb.dailyChecklistItem.findMany({ where: { userId, date }, orderBy: { order: 'asc' } });
    if (items.length === 0) return;

    let reportId = existingReportId;
    if (!reportId) {
      const user = await tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } });
      const dateFa = faDate(date);
      const report = await tenantDb.report.create({
        data: {
          title: `گزارش روزانه — ${dateFa}`,
          body: buildDailyReportBody(user?.name ?? '', dateFa, items),
          executionAt: date,
          createdByUserId: userId,
        },
      });
      reportId = report.id;
    }

    const pendingCount = await rollPendingToNextDay(tenantDb, userId, date);

    await tenantDb.dailyChecklistDayClose.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, reportId, rolledOver: true, auto: !existingReportId },
      update: { reportId, rolledOver: true },
    });

    await this.notifications
      .notify(tenantDb, {
        userId,
        type: 'daily-checklist.closed',
        title: existingReportId ? 'کارهای مانده‌ی امروز به فردا منتقل شد' : 'گزارش روزانه‌ی شما خودکار ثبت شد',
        body: pendingCount > 0 ? `${pendingCount} کار انجام‌نشده با برچسب «مانده از قبل» به لیست فردا اضافه شد` : 'همه‌ی کارهای امروز انجام شده بود',
        link: '/dashboard',
      })
      .catch(() => undefined);
  }
}
