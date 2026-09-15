import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { modulePriceForMode } from './module-pricing.js';

const RENEWAL_NOTICE_DAYS = 10;

/**
 * Runs once a day:
 *  1. برای هر ماژول با اشتراک ماهانه/سالانه که تا ۱۰ روز دیگر منقضی می‌شود
 *     و هنوز فاکتور تمدید بازی برایش صادر نشده — یک فاکتور تمدید تک‌ماژولی
 *     می‌سازد و pendingRenewalInvoiceId را روی آن قفل می‌کند (خودِ این فیلد
 *     idempotency را تضمین می‌کند — دیگر لازم به AuditLog dedupe نیست) و یک
 *     پیامک یادآوری برای مالک تننت می‌فرستد.
 *  2. هر ماژولی که دوره‌اش گذشته و هنوز تمدید نشده را غیرفعال می‌کند — یک
 *     مهلت است، نه قطع فوری: فاکتور تمدید از ۱۰ روز قبل در دسترس بوده.
 */
@Injectable()
export class ModuleRenewalService {
  private readonly logger = new Logger('ModuleRenewalService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run(): Promise<void> {
    await this.issueRenewalInvoices();
    await this.disableExpiredModules();
  }

  private async issueRenewalInvoices(): Promise<void> {
    const noticeThreshold = new Date(Date.now() + RENEWAL_NOTICE_DAYS * 86_400_000);

    const dueModules = await this.controlDb.tenantModule.findMany({
      where: {
        billingMode: { in: ['MONTHLY', 'YEARLY'] },
        currentPeriodEnd: { lte: noticeThreshold, gt: new Date() },
        pendingRenewalInvoiceId: null,
      },
      include: { module: true, tenant: true },
    });

    for (const tm of dueModules) {
      if (!tm.currentPeriodEnd || !tm.billingMode) continue;
      const amount = modulePriceForMode(tm.module, tm.billingMode);

      const invoice = await this.controlDb.invoice.create({
        data: {
          tenantId: tm.tenantId,
          amount,
          purpose: 'MODULE_RENEWAL',
          items: [{ moduleCode: tm.module.code, moduleName: tm.module.name, billingMode: tm.billingMode, amount }],
          status: 'PENDING',
          dueAt: tm.currentPeriodEnd,
        },
      });

      await this.controlDb.tenantModule.update({
        where: { id: tm.id },
        data: { pendingRenewalInvoiceId: invoice.id },
      });

      await this.notifyOwner(tm.tenantId, tm.tenant.name, tm.module.name);
    }
  }

  private async notifyOwner(tenantId: string, tenantName: string, moduleName: string): Promise<void> {
    if (!this.sms.isConfigured()) return;
    const membership = await this.controlDb.tenantMembership.findFirst({
      where: { tenantId, role: 'OWNER' },
      include: { globalUser: true },
    });
    const ownerPhone = membership?.globalUser.phone;
    if (!ownerPhone) return;

    const message = `اکسیر ERP: اشتراک ماژول «${moduleName}» شرکت ${tenantName} تا ${RENEWAL_NOTICE_DAYS} روز دیگر منقضی می‌شود. برای تمدید، فاکتور قابل پرداخت را در پنل خود ببینید.`;
    const result = await this.sms.sendSms(ownerPhone, message);
    if (!result.success) {
      this.logger.warn(`Module renewal reminder SMS failed for tenant ${tenantId}: ${result.error}`);
    }
  }

  private async disableExpiredModules(): Promise<void> {
    const expired = await this.controlDb.tenantModule.findMany({
      where: {
        billingMode: { in: ['MONTHLY', 'YEARLY'] },
        currentPeriodEnd: { lt: new Date() },
        status: { not: 'DISABLED' },
      },
      include: { module: true },
    });

    for (const tm of expired) {
      await this.controlDb.tenantModule.update({ where: { id: tm.id }, data: { status: 'DISABLED' } });
      await this.controlDb.auditLog.create({
        data: {
          actorType: 'system',
          tenantId: tm.tenantId,
          action: 'module.expired_disabled',
          entityType: 'ModuleDefinition',
          entityId: tm.moduleId,
          metadata: { code: tm.module.code },
        },
      });
    }
  }
}
