import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/** پاک‌سازی روزانه‌ی کلیدهای Idempotency منقضی (۷ روز) و ردیف‌های PENDING رهاشده — فقط تننت‌هایی که ماژول را دارند. */
@Injectable()
export class SyncCleanupService {
  private readonly logger = new Logger('SyncCleanup');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Cron('20 3 * * *', { timeZone: 'Asia/Tehran' })
  async run(): Promise<void> {
    const module = await this.controlDb.moduleDefinition.findUnique({ where: { code: 'offline-sync' } });
    if (!module) return;
    const tenants = await this.controlDb.tenant.findMany({
      where: { status: 'ACTIVE', tenantModules: { some: { moduleId: module.id, status: { in: ['INSTALLED', 'TRIAL'] } } } },
    });
    for (const t of tenants) {
      try {
        const db = this.tenantPrisma.forTenant({ dbHost: t.dbHost, dbPort: t.dbPort, dbName: t.dbName });
        const removed = await this.purge(db);
        if (removed > 0) this.logger.log(`Tenant ${t.slug}: purged ${removed} idempotency key(s)`);
      } catch (err) {
        this.logger.error(`purge failed for tenant ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async purge(db: ReturnType<TenantPrismaService['forTenant']>, now = new Date()): Promise<number> {
    const r = await db.syncIdempotency.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 3600_000) } }] },
    });
    return r.count;
  }
}
