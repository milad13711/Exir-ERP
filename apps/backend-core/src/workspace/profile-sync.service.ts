import { Injectable, Logger } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/**
 * همگام‌سازی نام نمایشی در همه‌ی محیط‌های کاری شخص: User (نسخه‌ی تننت) و Employee.fullName (در صورت لینک بودن).
 * سوابق تاریخی (رویدادها، پاراف‌ها، امضاها، لاگ‌ها) اسنپ‌شات نام هستند و عمداً دست نمی‌خورند.
 * شکست در یک تننت بقیه را متوقف نمی‌کند (best-effort؛ فقط لاگ).
 */
@Injectable()
export class ProfileSyncService {
  private readonly logger = new Logger('ProfileSync');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async syncName(globalUserId: string, name: string): Promise<{ tenants: number; failed: number }> {
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: { globalUserId, status: { in: ['ACTIVE', 'INVITED'] } },
      select: { tenant: { select: { id: true, slug: true, dbHost: true, dbPort: true, dbName: true } } },
    });
    let failed = 0;
    for (const m of memberships) {
      try {
        const db = this.tenantPrisma.forTenant({ dbHost: m.tenant.dbHost, dbPort: m.tenant.dbPort, dbName: m.tenant.dbName });
        const user = await db.user.findUnique({ where: { globalUserId }, select: { id: true } });
        if (!user) continue;
        await db.user.update({ where: { id: user.id }, data: { name } });
        await db.employee.updateMany({ where: { userId: user.id }, data: { fullName: name } });
      } catch (e) {
        failed++;
        this.logger.warn(`name sync failed for tenant ${m.tenant.slug}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { tenants: memberships.length, failed };
  }
}
