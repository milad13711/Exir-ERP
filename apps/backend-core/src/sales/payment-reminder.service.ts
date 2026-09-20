import { Injectable, Logger } from '@nestjs/common';
import { faDate } from '../common/persian.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { InvoicesService } from './invoices.service.js';

const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000; // حداکثر یک‌بار در روز

/**
 * Runs once a day across every active tenant's own database and reminds
 * about any invoice still owed (CONFIRMED/PARTIALLY_PAID with a remaining
 * balance) once its due date is within the tenant's configured window —
 * covers both "coming due soon" (positive days) and "already overdue"
 * (negative days), since the same threshold check handles both. Reminds
 * both sides: the customer by SMS (a nudge to pay), and every owner/admin
 * by in-app+email notification (so someone follows up). Each invoice is
 * reminded at most once every ~20 hours via lastPaymentReminderAt.
 */
@Injectable()
export class PaymentReminderService {
  private readonly logger = new Logger('PaymentReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: TenantSmsService,
    private readonly notifications: NotificationsService,
    private readonly invoices: InvoicesService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async sendDueReminders(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        await this.remindForTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Payment reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async remindForTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const reminderDays = await this.invoices.getPaymentReminderDays(tenantDb);

    const candidates = await tenantDb.salesInvoice.findMany({
      where: {
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] },
        dueAt: { not: null },
        OR: [{ lastPaymentReminderAt: null }, { lastPaymentReminderAt: { lt: new Date(Date.now() - REMINDER_COOLDOWN_MS) } }],
      },
      include: { contact: { select: { name: true, phone: true } } },
    });

    const due = candidates.filter((inv) => {
      const daysLeft = Math.ceil((inv.dueAt!.getTime() - Date.now()) / 86_400_000);
      return daysLeft <= reminderDays;
    });
    if (due.length === 0) return;

    const managers = await getManagerUsers(this.controlDb, tenantDb, tenantId);

    for (const invoice of due) {
      const remaining = invoice.total - invoice.paidAmount;
      const daysLeft = Math.ceil((invoice.dueAt!.getTime() - Date.now()) / 86_400_000);
      const dueDateFa = faDate(invoice.dueAt!);
      const overdueFa = daysLeft < 0 ? `${Math.abs(daysLeft)} روز از سررسید گذشته` : `${dueDateFa} سررسید می‌شود`;

      if (invoice.contact.phone) {
        const message = `اکسیر ERP: فاکتور شماره ${invoice.invoiceNo} به مبلغ باقی‌مانده‌ی ${remaining.toLocaleString('en-US')} تومان ${overdueFa}. لطفاً نسبت به تسویه اقدام فرمایید.`;
        const result = await this.sms.sendSms({ tenantId, tenantDb }, invoice.contact.phone, message);
        if (!result.success) {
          this.logger.warn(`Payment reminder SMS failed (tenant ${tenantId}, invoice ${invoice.id}): ${result.error}`);
        }
      }

      for (const manager of managers) {
        await this.notifications.notify(tenantDb, {
          userId: manager.tenantUserId,
          type: 'invoice.payment_due',
          title: `یادآوری وصول مطالبات — ${invoice.contact.name}`,
          body: `فاکتور شماره ${invoice.invoiceNo} به مبلغ باقی‌مانده‌ی ${remaining.toLocaleString('en-US')} تومان ${overdueFa}.`,
          link: '/sales',
        });
      }

      await tenantDb.salesInvoice.update({ where: { id: invoice.id }, data: { lastPaymentReminderAt: new Date() } });
    }
  }
}
