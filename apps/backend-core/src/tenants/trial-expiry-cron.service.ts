import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

/**
 * پایان دوره‌ی ۷ روزه‌ی رایگان (TenantsService.createTenant، مسیر ثبت‌نام
 * عمومی) را زمان‌محور اجرا می‌کند — تنها نقطه‌ای از منطق تریال که نمی‌تواند
 * با یک رویداد واقعی (خرید، ورود، ...) بلافاصله محاسبه شود. تننتی که هنوز
 * روی اشتراک TRIAL است و currentPeriodEnd آن گذشته، به PENDING_PAYMENT
 * می‌رود — همان وضعیتی که JwtAuthGuard از قبل روی هر درخواست مسدود می‌کند؛
 * پیش‌فاکتور از لحظه‌ی ثبت‌نام موجود است، پس نیازی به ساخت فاکتور جدید نیست.
 */
@Injectable()
export class TrialExpiryCronService {
  private readonly logger = new Logger('TrialExpiryCronService');

  constructor(private readonly controlDb: ControlPrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const expiredSubscriptions = await this.controlDb.subscription.findMany({
      where: {
        status: 'TRIAL',
        currentPeriodEnd: { lt: new Date() },
        tenant: { status: 'ACTIVE' },
      },
      include: { tenant: true },
    });

    for (const sub of expiredSubscriptions) {
      try {
        await this.controlDb.$transaction([
          this.controlDb.tenant.update({ where: { id: sub.tenantId }, data: { status: 'PENDING_PAYMENT' } }),
          this.controlDb.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } }),
        ]);
        this.logger.log(`Tenant ${sub.tenant.slug}: free trial expired, moved to PENDING_PAYMENT`);
      } catch (err) {
        this.logger.error(`Failed to expire trial for tenant ${sub.tenantId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
