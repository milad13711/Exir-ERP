import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { faDate } from '../common/persian.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { addDays, buildDailyReportBody, todayTehran } from './checklist-day.util.js';
import { rollPendingToNextDay } from './checklist-rollover.js';
import { SchedulableJobRegistryService, offsetPreset } from '../scheduling/schedulable-job-registry.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { isConfiguredHour } from '../scheduling/schedule-match.util.js';

export const DAILY_CHECKLIST_REPORT_JOB_CODE = 'daily-checklist-report';

/**
 * پایان‌روزِ خودکارِ چک‌لیست: اگر کاربر تا آخر وقت دکمه‌ی «ثبت گزارش روزانه» را نزده باشد، گزارش همان روز
 * (انجام‌شده‌ها و انجام‌نشده‌ها) خودکار در ماژول گزارش‌ها ثبت می‌شود و کارهای انجام‌نشده با برچسب «مانده از قبل»
 * به چک‌لیست فردا منتقل می‌شوند. هر (کاربر، روز) فقط یک‌بار بسته می‌شود (DailyChecklistDayClose).
 * دو اجرا: ۲۳:۵۵ به وقت تهران برای «امروز»، و ۰۰:۳۰ به‌عنوان جبران اگر سرور آن لحظه بالا نبوده برای «دیروز».
 */
@Injectable()
export class DailyChecklistCronService implements OnApplicationBootstrap, OnModuleInit {
  private readonly logger = new Logger('DailyChecklistCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
    private readonly jobRegistry: SchedulableJobRegistryService,
    private readonly scheduling: SchedulingService,
  ) {}

  /** ثبت در رجیستری «زمان‌بندی ارسال خودکار» (تنظیمات) — پیش‌فرض همان ساعت ۲۳:۵۵ فعلی. */
  onModuleInit(): void {
    this.jobRegistry.registerJob({
      code: DAILY_CHECKLIST_REPORT_JOB_CODE,
      label: 'ثبت خودکار گزارش پایان‌روزِ چک‌لیست',
      moduleCode: 'daily-checklist',
      defaultConfig: offsetPreset(0, 'SAME_DAY', 23, 55),
      allowedOffsets: [offsetPreset(0, 'SAME_DAY', 23, 55)],
      behaviorWired: true,
    });
  }

  /** بعد از هر بالا آمدن سرور، روزِ گذشته‌ای که هنوز بسته نشده (مثلاً گزارش دستی بدون انتقال) جبران می‌شود. */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.sweepAllTenants(false, false).catch(() => undefined), 30_000).unref();
  }

  /**
   * هر ساعت اجرا می‌شود (نه فقط ۲۳:۵۵ ثابت) تا هر تننت بتواند ساعت پایان‌روز
   * خودش را از تنظیمات «زمان‌بندی ارسال خودکار» انتخاب کند؛ per-tenant فقط
   * وقتی ساعت فعلی (به وقت تهران) با ساعت تنظیم‌شده‌ی همان تننت یکی باشد،
   * واقعاً بسته می‌شود — دقتِ این تطبیق در حد همین «ساعت» است، نه دقیقه‌ی دقیق.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async closeToday(): Promise<void> {
    await this.sweepAllTenants(true, true);
  }

  /** جبرانِ ثابتِ ۰۰:۳۰ — یک شبکه‌ی ایمنیِ همیشگی برای دیروزهایی که هنوز بسته نشده‌اند، مستقل از تنظیم هر تننت. */
  @Cron('30 0 * * *', { timeZone: 'Asia/Tehran' })
  async closeYesterday(): Promise<void> {
    await this.sweepAllTenants(false, false);
  }

  /**
   * چک‌لیست روزانه یک ماژول هسته‌ای (isCore) است — طبق همان قاعده‌ی ModuleGuard، یعنی
   * برای اکثر تننت‌ها هیچ ردیف TenantModule صریحی برایش وجود ندارد و همین‌طوری هم فعال
   * است؛ فقط با یک ردیف DISABLED صریح واقعاً خاموش می‌شود. فیلتر قبلی این فایل برعکس
   * فرض می‌کرد (فقط تننت‌هایی با ردیف INSTALLED/TRIAL صریح)، پس عملاً هیچ‌وقت هیچ
   * تننتی را برنمی‌گرداند و کرون سکوت می‌کرد — همین باعث می‌شد پایان‌روزِ خودکار در
   * عمل هرگز اجرا نشود.
   */
  private async eligibleTenants() {
    const module = await this.controlDb.moduleDefinition.findUnique({ where: { code: 'daily-checklist' } });
    if (!module) return [];
    return this.controlDb.tenant.findMany({
      where: {
        status: 'ACTIVE',
        ...(module.isCore
          ? { tenantModules: { none: { moduleId: module.id, status: 'DISABLED' } } }
          : { tenantModules: { some: { moduleId: module.id, status: { in: ['INSTALLED', 'TRIAL'] } } } }),
      },
    });
  }

  /** respectSchedule=true گیت ساعت هر تننت را از تنظیمات «زمان‌بندی ارسال خودکار» می‌خواند؛ false برای جبران ثابت ۰۰:۳۰ که مستقل از تنظیم تننت همیشه اجرا می‌شود. */
  private async sweepAllTenants(includeToday: boolean, respectSchedule: boolean): Promise<void> {
    const tenants = await this.eligibleTenants();
    for (const tenant of tenants) {
      try {
        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        if (respectSchedule) {
          const config = await this.scheduling.getConfig(tenantDb, DAILY_CHECKLIST_REPORT_JOB_CODE);
          if (!isConfiguredHour(new Date(), config)) continue;
        }
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

    // گزارش نهایی هر روز همین‌جاست (پایان‌روزِ واقعی) — پس محتوایش باید همیشه از روی
    // وضعیت لحظه‌ی همین بستن دوباره ساخته شود، نه گزارش نیمه‌کاره‌ای که کاربر شاید
    // وسط روز دستی ثبت کرده بود؛ وگرنه کارهای اضافه‌شده‌ی بعدِ آن ثبت دستی هیچ‌وقت در
    // گزارش نهایی دیده نمی‌شدند حتی وقتی درست به فردا منتقل می‌شوند.
    const user = await tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } });
    const dateFa = faDate(date);
    const title = `گزارش روزانه — ${dateFa}`;
    const body = buildDailyReportBody(user?.name ?? '', dateFa, items);

    let reportId = existingReportId;
    if (reportId) {
      await tenantDb.report.update({ where: { id: reportId }, data: { title, body, executionAt: date } });
    } else {
      const report = await tenantDb.report.create({ data: { title, body, executionAt: date, createdByUserId: userId } });
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
