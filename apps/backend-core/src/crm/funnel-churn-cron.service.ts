import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { FunnelService } from './funnel.service.js';

/**
 * ارزیابی روزانه‌ی ریسک ریزش مشتری برای همه‌ی تننت‌های فعال — زمان‌محور
 * است (بر اساس گذشت روز از موعد پیش‌بینی‌شده‌ی خرید بعدی)، پس برخلاف بقیه‌ی
 * منطق قیف که با رویداد واقعی (خرید، ثبت سرنخ) اجرا می‌شود، باید دوره‌ای
 * صدا زده شود. الگوی حلقه‌زدن روی تننت‌ها از RecurringInvoicesService گرفته
 * شده (apps/backend-core/src/sales/recurring-invoices.service.ts).
 */
@Injectable()
export class FunnelChurnCronService {
  private readonly logger = new Logger('FunnelChurnCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly funnel: FunnelService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        const tenantDb = this.tenantPrisma.forTenant({
          dbHost: tenant.dbHost,
          dbPort: tenant.dbPort,
          dbName: tenant.dbName,
        });
        const ctx: TenantRequestContext = {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          tenantDb,
          auth: { type: 'api_key', sub: 'system-funnel-churn-cron', tenantId: tenant.id, role: 'OWNER' },
        };
        const result = await this.funnel.evaluateChurnRisk(ctx);
        if (result.flaggedAtRisk > 0 || result.flaggedChurned > 0) {
          this.logger.log(
            `Tenant ${tenant.slug}: ${result.flaggedAtRisk} contact(s) flagged CHURN_RISK, ${result.flaggedChurned} flagged CHURNED`,
          );
        }
      } catch (err) {
        this.logger.error(`Churn sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
