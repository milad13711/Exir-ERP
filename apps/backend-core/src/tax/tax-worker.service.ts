import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { TaxInvoicesService } from './tax-invoices.service.js';

/**
 * کارگر ارسال/استعلام: هر دقیقه برای تننت‌هایی که ماژول «tax» را دارند، صورتحساب‌های تأییدشده را می‌فرستد و ارسال‌شده‌ها را استعلام می‌کند.
 * هیچ‌چیز بدون «تأیید قبلی مدیر + sendingEnabled + (محیط واقعی ⇒ تأیید آزمایشی)» ارسال نمی‌شود (TaxInvoicesService.dispatch + کلاینت).
 * برای جلوگیری از اجرای هم‌پوشان در یک پروسه، یک پرچم داخلی دارد.
 */
@Injectable()
export class TaxWorkerService {
  private readonly logger = new Logger('TaxWorkerService');
  private running = false;

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly invoices: TaxInvoicesService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const def = await this.controlDb.moduleDefinition.findUnique({ where: { code: 'tax' } });
      if (!def) return;
      const installs = await this.controlDb.tenantModule.findMany({ where: { moduleId: def.id, status: { in: ['INSTALLED', 'TRIAL'] } }, select: { tenantId: true } });
      if (installs.length === 0) return;
      const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE', id: { in: installs.map((i) => i.tenantId) } } });
      for (const tenant of tenants) {
        try {
          const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
          const ctx: TenantRequestContext = {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            tenantDb,
            auth: { type: 'api_key', sub: 'system-tax-worker', tenantId: tenant.id, role: 'OWNER' },
          };
          const r = await this.invoices.processTenant(ctx);
          if (r.sent || r.polled) this.logger.log(`Tenant ${tenant.slug}: sent ${r.sent}, polled ${r.polled}`);
        } catch (err) {
          this.logger.error(`Tax sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
