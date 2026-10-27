import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { RETENTION_KEY, RETENTION_MODULE, parseRetentionDays, systemRowsRetentionDays } from './user-activity.logic.js';

const CHUNK = 5_000;
const MAX_CHUNKS_PER_RUN = 20;

/**
 * نگهداشت لاگ فعالیت — آرشیو فعالیت کاربران (ردیف‌های دارای userId) به‌طور پیش‌فرض برای همیشه نگه داشته می‌شود.
 *  - تنظیم تننت (ModuleSetting activity/retentionDays، فقط مدیر): N روز ⇒ همه‌ی ردیف‌های قدیمی‌تر از N پاک می‌شوند؛ ۰/خالی ⇒ برای همیشه.
 *  - ردیف‌های بدون کاربر (خودکار/سیستمی) همیشه پس از ACTIVITY_LOG_RETENTION_DAYS (پیش‌فرض ۱۸۰ روز) پاک می‌شوند تا جدول بی‌انتها رشد نکند.
 * فشرده‌سازی ماهانه پیاده نشد (هزینه/ریسک)؛ رشد با ایندکس‌های userId و پاکسازی تکه‌تکه مهار می‌شود.
 */
export function retentionDays(): number {
  return systemRowsRetentionDays();
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
    const systemCutoff = new Date(Date.now() - retentionDays() * 86_400_000);
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } }).catch(() => []);
    for (const t of tenants) {
      try {
        const db = this.tenantPrisma.forTenant({ dbHost: t.dbHost, dbPort: t.dbPort, dbName: t.dbName });
        for (let i = 0; i < MAX_CHUNKS_PER_RUN; i += 1) {
          const n = await db.$executeRaw`DELETE FROM activity_logs WHERE id IN (SELECT id FROM activity_logs WHERE "userId" IS NULL AND "createdAt" < ${systemCutoff} ORDER BY "createdAt" LIMIT ${CHUNK})`;
          if (n < CHUNK) break;
        }
        const setting = await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: RETENTION_MODULE, key: RETENTION_KEY } } }).catch(() => null);
        const days = parseRetentionDays(setting?.value);
        if (days) {
          const userCutoff = new Date(Date.now() - days * 86_400_000);
          for (let i = 0; i < MAX_CHUNKS_PER_RUN; i += 1) {
            const n = await db.$executeRaw`DELETE FROM activity_logs WHERE id IN (SELECT id FROM activity_logs WHERE "createdAt" < ${userCutoff} ORDER BY "createdAt" LIMIT ${CHUNK})`;
            if (n < CHUNK) break;
          }
        }
      } catch (err) {
        this.logger.warn(`activity log retention failed for tenant ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
