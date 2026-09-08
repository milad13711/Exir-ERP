import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// پس از موعد پیش‌بینی‌شده‌ی خرید بعدی (میانگین فاصله‌ی خریدهای قبلی)، ابتدا
// ریسک ریزش نمایش داده می‌شود؛ اگر ۲ ماه دیگر هم خرید نکرد، غیرفعال می‌شود.
const CHURN_GRACE_DAYS = 60;

/**
 * موتور قیف سرنخ/مشتری: پیشروی مراحل، تبدیل خودکار سرنخ به مشتری پس از
 * اولین خرید، ثبت خریدهای بعدی به‌عنوان فرصت فروش (CrmDeal برد شده)، ثبت
 * سفیر برند، و ارزیابی دوره‌ای ریسک ریزش. همه‌ی مسیرهای واقعیِ ورود «خرید»
 * (فروشگاه آنلاین، فاکتور فروش) باید فقط از طریق recordPurchase عبور کنند
 * تا این منطق یک‌جا و سازگار بماند.
 */
@Injectable()
export class FunnelService {
  constructor(private readonly automation: AutomationEngineService) {}

  private async logStageEvent(
    ctx: TenantRequestContext,
    contactId: string,
    fromStage: string | null,
    toStage: string,
  ): Promise<void> {
    await ctx.tenantDb.crmFunnelStageEvent.create({
      data: { contactId, fromStage: fromStage as never, toStage: toStage as never },
    });
  }

  /** اولین رویداد قیف هر مخاطب — بلافاصله پس از ساخت رکورد صدا زده می‌شود. */
  async initLead(ctx: TenantRequestContext, contactId: string): Promise<void> {
    await this.logStageEvent(ctx, contactId, null, 'NEW_LEAD');
  }

  /**
   * اگر مخاطب معرفی‌شده باشد (referredById) معرف را — در همان لحظه‌ی ثبت
   * سرنخ/مشتری جدید، نه لزوماً پس از خرید او — سفیر برند علامت می‌زند.
   * idempotent است: اگر معرف از قبل سفیر بوده، کاری نمی‌کند.
   */
  async markReferrerAsAmbassador(ctx: TenantRequestContext, referrerContactId: string): Promise<void> {
    const referrer = await ctx.tenantDb.crmContact.findUnique({ where: { id: referrerContactId } });
    if (!referrer || referrer.isBrandAmbassador) return;
    const now = new Date();
    await ctx.tenantDb.crmContact.update({
      where: { id: referrer.id },
      data: { isBrandAmbassador: true, becameAmbassadorAt: now, funnelStage: 'BRAND_AMBASSADOR' },
    });
    await this.logStageEvent(ctx, referrer.id, referrer.funnelStage, 'BRAND_AMBASSADOR');
    await this.automation.emit(ctx, 'crm.contact.became_ambassador', {
      contactId: referrer.id,
      contactName: referrer.name,
      contactPhone: referrer.phone ?? null,
    });
  }

  /** پیشروی دستی مراحل پیش از خرید (NEW_LEAD/CONTACTED/QUALIFIED) — پس از اولین خرید دیگر دستی نیست. */
  async transitionLeadStage(
    ctx: TenantRequestContext,
    contactId: string,
    toStage: 'NEW_LEAD' | 'CONTACTED' | 'QUALIFIED',
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id: contactId } });
    if (!contact) return { ok: false, error: 'مخاطب یافت نشد' };
    if (contact.purchaseCount > 0) {
      return { ok: false, error: 'این مخاطب مشتری شده و مرحله از این پس به‌صورت خودکار مدیریت می‌شود' };
    }
    await ctx.tenantDb.crmContact.update({ where: { id: contactId }, data: { funnelStage: toStage } });
    await this.logStageEvent(ctx, contactId, contact.funnelStage, toStage);
    return { ok: true };
  }

  /**
   * نقطه‌ی ورود واحد برای هر «خرید واقعی» یک مخاطب (سفارش فروشگاه آنلاین،
   * پرداخت فاکتور فروش، ...). اولین خرید سرنخ را به مشتری تبدیل می‌کند؛
   * خریدهای بعدی به‌عنوان یک CrmDeal برد شده ثبت می‌شوند (طبق درخواست: «خرید
   * بعدی به‌عنوان فرصت فروش رقم بخورد») و میانگین فاصله‌ی خرید را برای
   * پیش‌بینی موعد خرید بعدی/ریسک ریزش به‌روزرسانی می‌کنند.
   */
  async recordPurchase(
    ctx: TenantRequestContext,
    contactId: string,
    amount: number,
    dealTitlePrefix = 'خرید مجدد',
  ): Promise<void> {
    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id: contactId } });
    if (!contact) return;

    const now = new Date();
    const isFirstPurchase = contact.purchaseCount === 0;

    let avgGap = contact.avgPurchaseGapDays;
    if (!isFirstPurchase && contact.lastPurchaseAt) {
      const gapDays = Math.max(1, Math.round((now.getTime() - contact.lastPurchaseAt.getTime()) / DAY_MS));
      const priorGapCount = Math.max(contact.purchaseCount - 1, 0);
      avgGap = avgGap == null ? gapDays : Math.round((avgGap * priorGapCount + gapDays) / (priorGapCount + 1));
    }

    const newStage = isFirstPurchase ? 'CUSTOMER' : contact.isBrandAmbassador ? 'BRAND_AMBASSADOR' : 'REPEAT_CUSTOMER';
    const newPurchaseCount = contact.purchaseCount + 1;

    await ctx.tenantDb.crmContact.update({
      where: { id: contactId },
      data: {
        funnelStage: newStage,
        isCustomer: true,
        firstPurchaseAt: isFirstPurchase ? now : contact.firstPurchaseAt,
        lastPurchaseAt: now,
        purchaseCount: newPurchaseCount,
        avgPurchaseGapDays: avgGap,
        churnWarningAt: null,
      },
    });
    await this.logStageEvent(ctx, contactId, contact.funnelStage, newStage);

    if (isFirstPurchase) {
      await this.automation.emit(ctx, 'crm.contact.converted_to_customer', {
        contactId,
        contactName: contact.name,
        contactPhone: contact.phone ?? null,
      });
    } else {
      // خرید بعدی = فرصت فروش برد شده، طبق درخواست کاربر
      await ctx.tenantDb.crmDeal.create({
        data: {
          title: `${dealTitlePrefix} #${newPurchaseCount} — ${contact.name}`,
          contactId,
          value: BigInt(Math.max(0, Math.round(amount))),
          stage: 'WON',
          ownerUserId: contact.ownerUserId,
          closedAt: now,
        },
      });
    }
  }

  /**
   * ارزیابی روزانه‌ی ریسک ریزش برای همه‌ی مشتریانی که حداقل یک بار خرید
   * تکراری داشته‌اند (پس بنچمارک فاصله‌ی خرید مشخص است). زمان‌محور است، پس
   * برخلاف بقیه‌ی این سرویس نمی‌تواند در لحظه‌ی یک رویداد محاسبه شود — باید
   * دوره‌ای (کرون روزانه) صدا زده شود.
   */
  async evaluateChurnRisk(ctx: TenantRequestContext): Promise<{ flaggedAtRisk: number; flaggedChurned: number }> {
    const now = Date.now();
    const candidates = await ctx.tenantDb.crmContact.findMany({
      where: {
        purchaseCount: { gte: 2 },
        avgPurchaseGapDays: { not: null },
        funnelStage: { in: ['REPEAT_CUSTOMER', 'BRAND_AMBASSADOR', 'CHURN_RISK'] },
      },
    });

    let flaggedAtRisk = 0;
    let flaggedChurned = 0;
    for (const c of candidates) {
      if (!c.lastPurchaseAt || c.avgPurchaseGapDays == null) continue;
      const daysSince = Math.floor((now - c.lastPurchaseAt.getTime()) / DAY_MS);
      const churnedThreshold = c.avgPurchaseGapDays + CHURN_GRACE_DAYS;

      if (daysSince > churnedThreshold) {
        if (c.funnelStage === 'CHURNED') continue;
        await ctx.tenantDb.crmContact.update({ where: { id: c.id }, data: { funnelStage: 'CHURNED' } });
        await this.logStageEvent(ctx, c.id, c.funnelStage, 'CHURNED');
        await this.automation.emit(ctx, 'crm.contact.churned', {
          contactId: c.id,
          contactName: c.name,
          contactPhone: c.phone ?? null,
        });
        flaggedChurned++;
      } else if (daysSince > c.avgPurchaseGapDays) {
        if (c.funnelStage === 'CHURN_RISK') continue;
        await ctx.tenantDb.crmContact.update({
          where: { id: c.id },
          data: { funnelStage: 'CHURN_RISK', churnWarningAt: new Date() },
        });
        await this.logStageEvent(ctx, c.id, c.funnelStage, 'CHURN_RISK');
        await this.automation.emit(ctx, 'crm.contact.churn_risk', {
          contactId: c.id,
          contactName: c.name,
          contactPhone: c.phone ?? null,
        });
        flaggedAtRisk++;
      }
    }

    return { flaggedAtRisk, flaggedChurned };
  }
}
