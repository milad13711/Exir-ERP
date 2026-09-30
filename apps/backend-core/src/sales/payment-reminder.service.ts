import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { faDate } from '../common/persian.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import type { SendSmsResult } from '../sms/exir-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { InvoicesService, buildPaymentInstructionLine } from './invoices.service.js';
import { SchedulableJobRegistryService, offsetPreset } from '../scheduling/schedulable-job-registry.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { matchesSchedule } from '../scheduling/schedule-match.util.js';
import { publicRef } from '../common/tenant-public-key.js';

const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000; // شبکه‌ی ایمنی؛ شرط اصلیِ ارسال الان تطبیق دقیقِ روز+ساعت تنظیم‌شده است، نه این کول‌داون

export const INVOICE_DUE_REMINDER_JOB_CODE = 'invoice-due-reminder';

/** همان متن یادآور تکمیل وجه که یادآور روزانه استفاده می‌کند — یک‌بار اینجا نوشته شده تا با ارسال دستی هم یکی باشد. */
function buildDueReminderMessage(invoice: { invoiceNo: number; total: number; paidAmount: number; dueAt: Date }): string {
  const remaining = invoice.total - invoice.paidAmount;
  const daysLeft = Math.ceil((invoice.dueAt.getTime() - Date.now()) / 86_400_000);
  const dueDateFa = faDate(invoice.dueAt);
  const overdueFa = daysLeft < 0 ? `${Math.abs(daysLeft)} روز از سررسید گذشته` : `${dueDateFa} سررسید می‌شود`;
  return `اکسیر ERP: فاکتور شماره ${invoice.invoiceNo} به مبلغ باقی‌مانده‌ی ${remaining.toLocaleString('en-US')} تومان ${overdueFa}. لطفاً نسبت به تسویه اقدام فرمایید.`;
}

/**
 * Runs every hour across every active tenant's own database. Per tenant, it
 * reads that tenant's "زمان‌بندی ارسال خودکار" (Settings → Scheduling)
 * config for this job — an offset like "۳ روز قبل" and an hour-of-day — and
 * only actually reminds when the current Tehran hour matches AND an
 * invoice's due date falls exactly on that offset from today (see
 * matchesSchedule in scheduling/schedule-match.util.ts). Previously this ran
 * on a fixed EVERY_DAY_AT_10AM with an inequality condition (any invoice
 * within N days, re-checked and re-sent roughly daily); that's now a single
 * configurable firing point instead of a recurring nag. Reminds both sides:
 * the customer by SMS (a nudge to pay), and every owner/admin by
 * in-app+email notification (so someone follows up). Each invoice is
 * reminded at most once every ~20 hours via lastPaymentReminderAt (now
 * mostly a safety net, since the day-match is already exact).
 */
@Injectable()
export class PaymentReminderService implements OnModuleInit {
  private readonly logger = new Logger('PaymentReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: TenantSmsService,
    private readonly notifications: NotificationsService,
    private readonly invoices: InvoicesService,
    private readonly jobRegistry: SchedulableJobRegistryService,
    private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit(): void {
    this.jobRegistry.registerJob({
      code: INVOICE_DUE_REMINDER_JOB_CODE,
      label: 'یادآوری سررسید فاکتور فروش',
      moduleCode: 'sales',
      defaultConfig: offsetPreset(3, 'DAYS_BEFORE', 10, 0),
      allowedOffsets: [
        offsetPreset(5, 'DAYS_BEFORE', 10, 0),
        offsetPreset(3, 'DAYS_BEFORE', 10, 0),
        offsetPreset(2, 'DAYS_BEFORE', 10, 0),
        offsetPreset(1, 'DAYS_BEFORE', 10, 0),
        offsetPreset(0, 'SAME_DAY', 10, 0),
        offsetPreset(1, 'DAYS_AFTER', 10, 0),
        offsetPreset(3, 'DAYS_AFTER', 10, 0),
        offsetPreset(7, 'DAYS_AFTER', 10, 0),
      ],
      behaviorWired: true,
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendDueReminders(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        await this.remindForTenant(tenant.id, tenant.slug, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Payment reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async remindForTenant(tenantId: string, tenantSlug: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const schedule = await this.scheduling.getConfig(tenantDb, INVOICE_DUE_REMINDER_JOB_CODE);
    const now = new Date();
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

    const candidates = await tenantDb.salesInvoice.findMany({
      where: {
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] },
        dueAt: { not: null },
        OR: [{ lastPaymentReminderAt: null }, { lastPaymentReminderAt: { lt: new Date(Date.now() - REMINDER_COOLDOWN_MS) } }],
      },
      include: { contact: { select: { name: true, phone: true } } },
    });

    const due = candidates.filter((inv) => matchesSchedule(now, inv.dueAt!, schedule));
    if (due.length === 0) return;

    const managers = await getManagerUsers(this.controlDb, tenantDb, tenantId);

    for (const invoice of due) {
      const remaining = invoice.total - invoice.paidAmount;
      const daysLeft = Math.ceil((invoice.dueAt!.getTime() - Date.now()) / 86_400_000);
      const dueDateFa = faDate(invoice.dueAt!);
      const overdueFa = daysLeft < 0 ? `${Math.abs(daysLeft)} روز از سررسید گذشته` : `${dueDateFa} سررسید می‌شود`;

      // نقدی یعنی پرداخت حضوری در محل — هیچ پیامک یادآور پرداختی برای مشتری معنی ندارد.
      if (invoice.contact.phone && invoice.paymentMethod !== 'CASH') {
        const publicUrl = `${publicWebUrl}/invoice/${publicRef(tenantSlug)}/${invoice.publicToken}`;
        const message = buildDueReminderMessage({ ...invoice, publicUrl } as unknown as Parameters<typeof buildDueReminderMessage>[0]);
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

  /**
   * Manual, one-off version of the same "please pay" SMS for a single
   * invoice — used by the dashboard's due/overdue-invoices widget so a user
   * can nudge a specific customer right away instead of waiting for the
   * daily sweep. Bumps the same lastPaymentReminderAt the cron reads, so the
   * daily sweep doesn't immediately re-remind right after a manual send.
   */
  async sendManualReminder(ctx: TenantRequestContext, invoiceId: string): Promise<SendSmsResult> {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: { contact: { select: { name: true, phone: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (!invoice.dueAt) return { success: false, error: 'این فاکتور سررسید ندارد' };
    if (!invoice.contact.phone) return { success: false, error: 'مشتری این فاکتور شماره تماس ثبت‌شده ندارد' };
    if (invoice.paymentMethod === 'CASH') return { success: false, error: 'روش پرداخت این فاکتور نقدی است — یادآور پیامکی معنی ندارد' };

    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    const publicUrl = `${publicWebUrl}/invoice/${publicRef(ctx.tenantSlug)}/${invoice.publicToken}`;
    const message = buildDueReminderMessage({ ...invoice, publicUrl } as unknown as Parameters<typeof buildDueReminderMessage>[0]);
    const result = await this.sms.sendSms({ tenantId: ctx.tenantId, tenantDb: ctx.tenantDb }, invoice.contact.phone, message);
    if (result.success) {
      await ctx.tenantDb.salesInvoice.update({ where: { id: invoiceId }, data: { lastPaymentReminderAt: new Date() } });
    }
    return result;
  }
}
