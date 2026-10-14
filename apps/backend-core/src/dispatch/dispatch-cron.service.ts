import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { DispatchSuggestionsService } from './dispatch-suggestions.service.js';

/** هر ۵ دقیقه برای تننت‌هایی که ماژول dispatch دارند، ماشه‌ی «اعلام بار» دستورهای تولید را بررسی می‌کند. */
@Injectable()
export class DispatchCronService {
  private readonly logger = new Logger('DispatchCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly suggestions: DispatchSuggestionsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const installed = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'dispatch' } },
      });
      if (!installed) continue;
      try {
        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        const ctx = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
        const productionInstalled = await this.controlDb.tenantModule.findFirst({
          where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'production' } },
        });
        if (productionInstalled) await this.suggestions.scanProduction(ctx);
      } catch (err) {
        this.logger.error(`Dispatch scan failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
