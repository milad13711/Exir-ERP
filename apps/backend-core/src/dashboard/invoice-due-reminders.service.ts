import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { PaymentReminderService } from '../sales/payment-reminder.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { SendSmsResult } from '../sms/exir-sms.service.js';

/**
 * Two small actions the dashboard's "فاکتورهای نزدیک به سررسید و معوق"
 * widget offers per invoice: an inline manual SMS nudge (reusing the same
 * message PaymentReminderService's daily cron sends), and a lightweight
 * phone-follow-up log (who called, what was said/promised, how the
 * customer reacted) — a history, not a workflow state machine.
 */
@Injectable()
export class InvoiceDueRemindersService {
  constructor(private readonly paymentReminder: PaymentReminderService) {}

  async remindSms(ctx: TenantRequestContext, invoiceId: string): Promise<SendSmsResult> {
    return this.paymentReminder.sendManualReminder(ctx, invoiceId);
  }

  async createFollowUp(
    ctx: TenantRequestContext,
    invoiceId: string,
    dto: { note: string; outcome?: string },
  ) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');

    const followedUpByUserId = await resolveTenantUserId(ctx).catch(() => null);
    return ctx.tenantDb.invoiceFollowUp.create({
      data: {
        invoiceId,
        note: dto.note,
        outcome: dto.outcome ?? null,
        followedUpByUserId,
      },
      include: { followedUpBy: { select: { name: true } } },
    });
  }

  async listFollowUps(ctx: TenantRequestContext, invoiceId: string) {
    return ctx.tenantDb.invoiceFollowUp.findMany({
      where: { invoiceId },
      include: { followedUpBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
