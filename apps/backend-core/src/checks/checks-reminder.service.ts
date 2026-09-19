import { Injectable, Logger } from '@nestjs/common';
import { faDate } from '../common/persian.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ChecksService } from './checks.service.js';

/**
 * Runs once a day across every active tenant's own database (checks live
 * per-tenant, so this can't be a single control-plane query like the
 * billing dunning cron) and reminds about any PENDING check whose due date
 * falls within its own reminderDaysBefore window and hasn't been reminded
 * yet. Two channels, independently toggleable per tenant (see
 * ChecksService.getReminderChannels):
 *   - SMS to the counterparty's own phone (the customer for a RECEIVED
 *     check — they need to keep the balance ready; the supplier for an
 *     ISSUED check — a courtesy heads-up).
 *   - An in-app + email notification (via NotificationsService, which
 *     already respects each user's own channel preference) to whoever
 *     created the check record, as the internal "don't forget" nudge.
 * Each check is only ever reminded once (reminderSentAt is stamped).
 */
@Injectable()
export class ChecksReminderService {
  private readonly logger = new Logger('ChecksReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: ExirSmsService,
    private readonly notifications: NotificationsService,
    private readonly checks: ChecksService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDueReminders(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        await this.remindForTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Check reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async remindForTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });

    // پنجره‌ی یادآوری هر چک با خودش متفاوت است، پس با یک بازه‌ی سخاوتمندانه
    // (۳۰ روز) واکشی می‌کنیم و شرط دقیق را در حافظه اعمال می‌کنیم.
    const candidates = await tenantDb.check.findMany({
      where: {
        status: { in: ['PENDING', 'DEPOSITED'] },
        reminderSentAt: null,
        dueDate: { lte: new Date(Date.now() + 30 * 86_400_000) },
      },
      include: {
        contact: { select: { name: true, phone: true } },
      },
    });

    const dueNow = candidates.filter((c) => {
      const daysLeft = Math.ceil((c.dueDate.getTime() - Date.now()) / 86_400_000);
      return daysLeft <= c.reminderDaysBefore;
    });
    if (dueNow.length === 0) return;

    const channels = await this.checks.getReminderChannels(tenantDb);

    for (const check of dueNow) {
      const partyName = check.contact?.name;
      const partyPhone = check.contact?.phone;
      const directionFa = check.direction === 'RECEIVED' ? 'دریافتی از' : 'صادرشده برای';
      const dueDateFa = faDate(check.dueDate);

      if (channels.sms && partyPhone && this.sms.isConfigured()) {
        const message =
          check.direction === 'RECEIVED'
            ? `یادآوری: چک شما به شماره صیادی ${check.sayadId} به مبلغ ${check.amount.toLocaleString('en-US')} تومان در تاریخ ${dueDateFa} نزد ما سررسید می‌شود — لطفاً از موجودی کافی حساب اطمینان حاصل فرمایید.`
            : `یادآوری: چک ما به شماره صیادی ${check.sayadId} به مبلغ ${check.amount.toLocaleString('en-US')} تومان در تاریخ ${dueDateFa} نزد شما سررسید می‌شود.`;
        const result = await this.sms.sendSms(partyPhone, message);
        if (!result.success) {
          this.logger.warn(`Check reminder SMS failed (tenant ${tenantId}, check ${check.id}): ${result.error}`);
        }
      }

      if (channels.notification && check.createdByUserId) {
        await this.notifications.notify(tenantDb, {
          userId: check.createdByUserId,
          type: 'check.due_soon',
          title: `یادآوری چک ${directionFa} ${partyName ?? ''}`,
          body: `چک به شماره صیادی ${check.sayadId} به مبلغ ${check.amount.toLocaleString('en-US')} تومان در تاریخ ${dueDateFa} سررسید می‌شود.`,
          link: '/checks',
        });
      }

      await tenantDb.check.update({ where: { id: check.id }, data: { reminderSentAt: new Date() } });
    }
  }
}
