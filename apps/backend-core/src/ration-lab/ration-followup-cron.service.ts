import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * پیگیری زمان‌محور نمونه‌های آزمایشگاه جیره — سه ردیف RationFollowUpCheckin
 * (۷/۱۴/۳۰ روزه) در لحظه‌ی ثبت گزارش آزمایشگاه از پیش ساخته می‌شوند
 * (PublicLabReviewService.submitReport)؛ این cron فقط روزانه چک می‌کند کدام
 * سررسیدشان رسیده و هنوز Task ندارند، و برای همان یک Task+Notification به
 * کارشناسی که نمونه را از دامدار گرفته می‌سازد — الگوی حلقه‌زدن روی تننت‌ها
 * از FunnelChurnCronService.
 */
@Injectable()
export class RationFollowUpCronService {
  private readonly logger = new Logger('RationFollowUpCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({
      where: {
        status: 'ACTIVE',
        tenantModules: { some: { status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'ration-lab' } } },
      },
    });

    for (const tenant of tenants) {
      try {
        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });

        const due = await tenantDb.rationFollowUpCheckin.findMany({
          where: { completedAt: null, scheduledAt: { lte: new Date() } },
          include: { sample: { select: { sampleNo: true, collectedByUserId: true } } },
        });

        let created = 0;
        for (const checkin of due) {
          if (!checkin.sample.collectedByUserId) continue;
          const existingTask = await tenantDb.task.findFirst({
            where: { relatedModule: 'ration-lab', relatedEntityId: checkin.id },
          });
          if (existingTask) continue;

          await tenantDb.task.create({
            data: {
              title: `پیگیری ${checkin.dueOffsetDays} روزه — نمونه ${checkin.sample.sampleNo}`,
              assignedUserId: checkin.sample.collectedByUserId,
              relatedModule: 'ration-lab',
              relatedEntityId: checkin.id,
              priority: 'NORMAL',
              dueAt: checkin.scheduledAt,
            },
          });
          await this.notifications.notify(tenantDb, {
            userId: checkin.sample.collectedByUserId,
            type: 'ration-lab.followup.due',
            title: `پیگیری ${checkin.dueOffsetDays} روزه‌ی نمونه ${checkin.sample.sampleNo} رسیده است`,
            link: '/ration-lab',
          });
          created += 1;
        }
        if (created > 0) this.logger.log(`Tenant ${tenant.slug}: created ${created} follow-up task(s)`);
      } catch (err) {
        this.logger.error(`Ration follow-up sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
