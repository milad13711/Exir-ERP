import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

const CHUNK = 5_000;
const MAX_CHUNKS_PER_RUN = 20;

/** نگهداشت لاگ فعالیت: ردیف‌های قدیمی‌تر از ACTIVITY_LOG_RETENTION_DAYS (پیش‌فرض ۱۸۰ روز) به‌صورت تکه‌تکه پاک می‌شوند. */
export function retentionDays(): number {
  const n = Number(process.env.ACTIVITY_LOG_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
}

@Injectable()
export class ActivityRetentionService {
  private readonly logger = new Logger('ActivityRetention');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Tehran' })
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - retentionDays() * 86_400_000);
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } }).catch(() => []);
    for (const t of tenants) {
      try {
        const db = this.tenantPrisma.forTenant({ dbHost: t.dbHost, dbPort: t.dbPort, dbName: t.dbName });
        for (let i = 0; i < MAX_CHUNKS_PER_RUN; i += 1) {
          const n = await db.$executeRaw`DELETE FROM activity_logs WHERE id IN (SELECT id FROM activity_logs WHERE "createdAt" < ${cutoff} ORDER BY "createdAt" LIMIT ${CHUNK})`;
          if (n < CHUNK) break;
        }
      } catch (err) {
        this.logger.warn(`activity log retention failed for tenant ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
