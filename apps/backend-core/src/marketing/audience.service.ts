import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { AudienceFilterDto } from './dto/audience-filter.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AudienceContact = {
  id: string;
  name: string;
  phone: string | null;
};

/**
 * تبدیل معیار فیلتر کمپین (AudienceFilterDto) به لیست واقعی مخاطبین. اغلب
 * فیلترها با شرط ساده‌ی Prisma قابل بیانند؛ خرید محصول خاص نیاز به یک کوئری
 * جداگانه روی StoreOrderLine دارد (productName اسنپ‌شات است، بدون FK)، و
 * «موعد خرید مجدد» چون رابطه‌ی غیرخطی با تاریخ دارد در جاوااسکریپت فیلتر می‌شود.
 */
@Injectable()
export class AudienceService {
  async resolve(ctx: TenantRequestContext, filter: AudienceFilterDto = {}): Promise<AudienceContact[]> {
    const now = Date.now();
    const where: Record<string, unknown> = {};

    if (filter.funnelStages?.length) where.funnelStage = { in: filter.funnelStages };
    if (filter.minPurchaseCount != null) where.purchaseCount = { gte: filter.minPurchaseCount };
    if (filter.isBrandAmbassador != null) where.isBrandAmbassador = filter.isBrandAmbassador;
    if (filter.source) where.source = { contains: filter.source, mode: 'insensitive' };
    if (filter.frequentBuyerMaxGapDays != null) where.avgPurchaseGapDays = { lte: filter.frequentBuyerMaxGapDays };

    const lastPurchaseCond: Record<string, Date> = {};
    if (filter.minDaysSinceLastPurchase != null) {
      lastPurchaseCond.lte = new Date(now - filter.minDaysSinceLastPurchase * DAY_MS);
    }
    if (filter.maxDaysSinceLastPurchase != null) {
      lastPurchaseCond.gte = new Date(now - filter.maxDaysSinceLastPurchase * DAY_MS);
    }
    if (Object.keys(lastPurchaseCond).length > 0) where.lastPurchaseAt = lastPurchaseCond;

    let allowedContactIds: Set<string> | null = null;
    if (filter.purchasedProductContains) {
      const lines = await ctx.tenantDb.storeOrderLine.findMany({
        where: { productName: { contains: filter.purchasedProductContains, mode: 'insensitive' } },
        select: { order: { select: { contactId: true } } },
      });
      allowedContactIds = new Set(lines.map((l) => l.order.contactId).filter((id): id is string => !!id));
      if (allowedContactIds.size === 0) return [];
      where.id = { in: [...allowedContactIds] };
    }

    let contacts = await ctx.tenantDb.crmContact.findMany({
      where: { ...where, phone: { not: null } },
      select: { id: true, name: true, phone: true, avgPurchaseGapDays: true, lastPurchaseAt: true },
      orderBy: { createdAt: 'desc' },
    });

    if (filter.dueForRepurchase) {
      contacts = contacts.filter((c) => {
        if (!c.lastPurchaseAt || c.avgPurchaseGapDays == null) return false;
        const daysSince = Math.floor((now - c.lastPurchaseAt.getTime()) / DAY_MS);
        // یک هفته زودتر تا زمانی که هنوز ریسک ریزش کامل نشده، «الان موعد است» تلقی می‌شود
        return daysSince >= c.avgPurchaseGapDays - 7;
      });
    }

    return contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
  }
}
