import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { isPlanLevelInvoice } from '../billing/subscription-summary.js';

/**
 * پایان دوره‌ی ۷ روزه‌ی رایگان (TenantsService.createTenant، مسیر ثبت‌نام
 * عمومی) را زمان‌محور اجرا می‌کند — تنها نقطه‌ای از منطق تریال که نمی‌تواند
 * با یک رویداد واقعی (خرید، ورود، ...) بلافاصله محاسبه شود. تننتی که هنوز
 * روی اشتراک TRIAL است و currentPeriodEnd آن گذشته، به PENDING_PAYMENT
 * می‌رود — وضعیتی که اجازه‌ی ورود به مشتری را می‌دهد اما JwtAuthGuard دسترسی
 * را به صفحه‌ی صورت‌حساب (billing/*) محدود می‌کند تا فاکتور را ببیند و
 * پرداخت کند؛ پیش‌فاکتور از لحظه‌ی ثبت‌نام موجود است، پس نیازی به ساخت
 * فاکتور جدید نیست.
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
        // پیش‌فاکتور در طول دوره‌ی آزمایشی پرداخت شده؟ (قبل از اصلاح settleInvoicePaid، پرداخت اشتراک را به ACTIVE نمی‌برد و مشتری پرداخت‌کننده قفل می‌شد)
        const paid = await this.controlDb.invoice.findMany({ where: { tenantId: sub.tenantId, status: 'PAID', paidAt: { gte: sub.startedAt } }, select: { purpose: true, items: true } });
        if (paid.some(isPlanLevelInvoice)) {
          const end = new Date();
          end.setMonth(end.getMonth() + 1);
          await this.controlDb.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', currentPeriodEnd: end } });
          this.logger.log(`Tenant ${sub.tenant.slug}: trial ended but plan invoice already paid — subscription set ACTIVE`);
          continue;
        }
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
