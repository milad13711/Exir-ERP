import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/** هر ساعت روی تننت‌های دارای ماژول رویداد اجرا می‌شود: رویدادهای منتشرشده‌ای که زمان پایانشان گذشته به‌طور خودکار «برگزارشده» علامت می‌خورند — تا لیست عمومی «رویدادهای پیش رو» همیشه واقعی بماند. */
@Injectable()
export class EventsStatusCronService {
  private readonly logger = new Logger('EventsStatusCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const eventsModule = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'events' } },
      });
      if (!eventsModule) continue;
      try {
        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        await tenantDb.event.updateMany({ where: { status: 'PUBLISHED', endAt: { lt: new Date() } }, data: { status: 'COMPLETED' } });
      } catch (err) {
        this.logger.error(`Event status sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
