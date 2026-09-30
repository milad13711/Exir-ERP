import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

export type CreateOpportunityInput = {
  contactId: string;
  title: string;
  value?: number;
  stage?: 'NEW' | 'CONTACTED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
  expectedCloseAt?: string;
  /** خلاصه‌ی گفتگو/جلسه که پرسنل دستی وارد می‌کند — به‌عنوان اولین یادداشتِ فرصت ثبت می‌شود. */
  summary?: string;
  ownerUserId?: string | null;
};

/**
 * ایجاد فرصت فروش از دل ماژول‌های دیگر (نوبت‌دهی، مشاوره) — بعد از یک نوبت/جلسه‌ی انجام‌شده،
 * پرسنل می‌تواند برای پیگیری آن یک فرصت فروش بسازد. چون سیستم نمی‌تواند محتوای گفتگو را بداند،
 * فقط از کاربر یک خلاصه‌ی دستی می‌گیرد و آن را به‌عنوان یادداشتِ اول فرصت ثبت می‌کند.
 * منطق و رویدادهای این متد همان مسیر DealsController.create است — تا فرصتِ ساخته‌شده از این
 * مسیر با فرصتِ ساخته‌شده مستقیم از داخل CRM هیچ تفاوتی نداشته باشد.
 */
@Injectable()
export class CrmOpportunityService {
  constructor(private readonly webhooks: WebhooksService) {}

  async create(ctx: TenantRequestContext, input: CreateOpportunityInput) {
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: input.contactId } });

    const deal = await ctx.tenantDb.crmDeal.create({
      data: {
        title: input.title,
        contactId: input.contactId,
        value: BigInt(input.value ?? 0),
        stage: input.stage ?? 'NEW',
        expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : undefined,
        ownerUserId: input.ownerUserId ?? undefined,
      },
      include: { contact: { select: { id: true, name: true, company: true } } },
    });

    if (input.summary?.trim()) {
      await ctx.tenantDb.crmActivity.create({
        data: {
          type: 'NOTE',
          body: input.summary.trim(),
          dealId: deal.id,
          contactId: input.contactId,
          userId: input.ownerUserId ?? undefined,
        },
      });
    }

    await ctx.tenantDb.activityLog.create({
      data: {
        userId: input.ownerUserId ?? undefined,
        action: 'crm.deal.created',
        entityType: 'CrmDeal',
        entityId: deal.id,
        metadata: { title: deal.title, value: Number(deal.value) },
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'crm.deal.created', {
      id: deal.id,
      title: deal.title,
      value: Number(deal.value),
      stage: deal.stage,
    });

    return deal;
  }
}
