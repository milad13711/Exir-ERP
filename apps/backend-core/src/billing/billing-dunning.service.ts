import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { computeTenantEntitlement, isPlanLevelInvoice, tehranDayIndex } from './subscription-summary.js';

// Reminder thresholds, in whole days relative to currentPeriodEnd: positive
// = days remaining before expiry, negative = days already overdue (still
// nudged a few times before we give up — the subscription itself is left
// alone; suspension is a separate, explicit admin action).
const REMINDER_DAYS = [7, 3, 1, 0, -1, -3, -7] as const;

/**
 * Runs once a day, finds every shared-cloud subscription whose expiry lands
 * on one of REMINDER_DAYS from today, and sends the tenant owner a
 * reminder SMS. Each (tenant, day-offset) pair is only ever sent once —
 * tracked via an AuditLog row rather than a schema change, since this is
 * purely a "did we already nudge them today" check.
 */
@Injectable()
export class BillingDunningService {
  private readonly logger = new Logger('BillingDunningService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendRenewalReminders(): Promise<void> {
    if (!this.sms.isConfigured()) return;

    const subscriptions = await this.controlDb.subscription.findMany({
      where: {
        status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
        tenant: { deploymentType: 'SHARED_CLOUD', status: 'ACTIVE' },
      },
      include: { tenant: true, plan: true },
    });

    for (const subscription of subscriptions) {
      // مادام‌العمر هرگز یادآوری نمی‌گیرد؛ روزها به تقویم تهران (همان منطق هدر/تنظیمات) شمرده می‌شود، نه round میلی‌ثانیه‌ای
      if (subscription.lifetime) continue;
      const now = new Date();
      const daysLeft = tehranDayIndex(subscription.currentPeriodEnd) - tehranDayIndex(now);
      if (!REMINDER_DAYS.includes(daysLeft as (typeof REMINDER_DAYS)[number])) continue;

      // فقط وقتی واقعاً تمدیدی لازم است — نه برای پرداخت‌کننده‌ی رکورد-قدیمی یا مادام‌العمر (منبع واحد: subscription-summary)
      const invoices = await this.controlDb.invoice.findMany({
        where: { tenantId: subscription.tenantId, status: { in: ['PENDING', 'AWAITING_APPROVAL', 'PAID'] } },
        orderBy: { issuedAt: 'desc' },
        take: 50,
        select: { id: true, amount: true, status: true, purpose: true, items: true, dueAt: true, paidAt: true },
      });
      const ent = computeTenantEntitlement(
        {
          tenantStatus: subscription.tenant.status,
          subscription: { status: subscription.status, startedAt: subscription.startedAt, currentPeriodEnd: subscription.currentPeriodEnd, lifetime: subscription.lifetime, autoRenew: subscription.autoRenew, planName: subscription.plan.name, planCode: subscription.plan.code },
          planInvoices: invoices.filter(isPlanLevelInvoice),
        },
        now,
      );
      if (ent.state !== 'EXPIRING_SOON' && ent.state !== 'GRACE' && ent.state !== 'TRIAL') continue;

      await this.remindOne(subscription.tenantId, subscription.tenant.name, daysLeft, subscription.plan.name);
    }
  }

  private async remindOne(tenantId: string, tenantName: string, daysLeft: number, planName: string): Promise<void> {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
    const dedupeKey = `renewal_reminder:${daysLeft}:${today}`;

    const alreadySent = await this.controlDb.auditLog.findFirst({
      where: { tenantId, action: 'billing.reminder_sms_sent', metadata: { path: ['dedupeKey'], equals: dedupeKey } },
    });
    if (alreadySent) return;

    const membership = await this.controlDb.tenantMembership.findFirst({
      where: { tenantId, role: 'OWNER' },
      include: { globalUser: true },
    });
    const ownerPhone = membership?.globalUser.phone;
    if (!ownerPhone) return;

    const message =
      daysLeft >= 0
        ? `اکسیر ERP: اشتراک «${planName}» شرکت ${tenantName} تا ${daysLeft} روز دیگر منقضی می‌شود. برای تمدید، در پنل بخش «اشتراک و صورتحساب» روی «درخواست صدور فاکتور تمدید» بزنید.`
        : `اکسیر ERP: اشتراک «${planName}» شرکت ${tenantName} ${Math.abs(daysLeft)} روز است که منقضی شده. برای جلوگیری از قطع دسترسی، از بخش «اشتراک و صورتحساب» پنل فاکتور تمدید بگیرید و پرداخت کنید.`;

    const result = await this.sms.sendSms(ownerPhone, message);
    if (!result.success) {
      this.logger.warn(`Renewal reminder SMS failed for tenant ${tenantId}: ${result.error}`);
      return;
    }

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'system',
        tenantId,
        action: 'billing.reminder_sms_sent',
        entityType: 'Subscription',
        metadata: { dedupeKey, daysLeft },
      },
    });
  }
}
