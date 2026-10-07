import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ActivityLogService } from './activity-log.service.js';
import { faDate } from '../common/persian.js';

export const AUTO_FILED_ACTION = 'daily-checklist.report.auto_filed';
const WINDOW_MS = 75 * 60_000;

/**
 * ثبت «گزارش روزانه به‌صورت خودکار ثبت شد» در لاگ فعالیت — بدون تغییر در کرون چک‌لیست روزانه:
 * هر ساعت، روزهای بسته‌شده‌ی خودکار (DailyChecklistDayClose.auto) در ۷۵ دقیقه‌ی اخیر را می‌خواند
 * و اگر هنوز لاگی ندارند، با کنشگر AUTOMATIC ثبت می‌کند (idempotent با entityId = شناسه‌ی بستن).
 */
@Injectable()
export class ActivitySystemSyncService {
  private readonly logger = new Logger('ActivitySystemSync');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  @Cron('40 * * * *')
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } }).catch(() => []);
    for (const t of tenants) {
      try {
        await this.syncAutoFiledReports(this.tenantPrisma.forTenant({ dbHost: t.dbHost, dbPort: t.dbPort, dbName: t.dbName }));
      } catch (err) {
        this.logger.warn(`auto-filed report sync failed for tenant ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async syncAutoFiledReports(db: TenantPrismaClient, now: Date = new Date()): Promise<number> {
    const closes = await db.dailyChecklistDayClose.findMany({
      where: { auto: true, createdAt: { gte: new Date(now.getTime() - WINDOW_MS) } },
      select: { id: true, userId: true, date: true, reportId: true },
    });
    if (closes.length === 0) return 0;
    const done = await db.activityLog.findMany({
      where: { action: AUTO_FILED_ACTION, entityId: { in: closes.map((c) => c.id) } },
      select: { entityId: true },
    });
    const doneIds = new Set(done.map((d) => d.entityId));
    let n = 0;
    for (const c of closes) {
      if (doneIds.has(c.id)) continue;
      this.activity.logSystem(db, {
        action: AUTO_FILED_ACTION,
        moduleCode: 'daily-checklist',
        actionType: 'create',
        entityType: 'report',
        entityId: c.id,
        actorType: 'AUTOMATIC',
        userId: c.userId,
        summary: `ثبت خودکار گزارش روزانه (${faDate(c.date)}) در پایان روز`,
        metadata: { reportId: c.reportId, reportDate: c.date.toISOString().slice(0, 10) },
      });
      n += 1;
    }
    return n;
  }
}
