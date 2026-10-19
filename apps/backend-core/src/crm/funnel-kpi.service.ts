import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { FUNNEL_PARTY_WHERE, andWhere, computeReached, isConverted } from './funnel-lifecycle.js';

export const FUNNEL_STAGE_LABELS_FA: Record<string, string> = {
  NEW_LEAD: 'سرنخ جدید',
  CONTACTED: 'در تماس',
  QUALIFIED: 'واجد شرایط',
  CUSTOMER: 'مشتری',
  REPEAT_CUSTOMER: 'خرید تکراری',
  BRAND_AMBASSADOR: 'سفیر برند',
  CHURN_RISK: 'در معرض ریزش',
  CHURNED: 'غیرفعال شده',
  DISQUALIFIED: 'رد صلاحیت شده',
};

const ALL_STAGES = Object.keys(FUNNEL_STAGE_LABELS_FA);

// پنج مرحله‌ی اصلیِ قیف که نرخ تبدیل و گلوگاه رویشان محاسبه می‌شود. سه‌گانه‌ی
// پایین قیف (سفیر برند/ریسک ریزش/غیرفعال) مسیرهای انشعابی سلامت برندند، نه
// پله‌های همین قیف خطی — با شاخص‌های جداگانه (ambassador ratio, churn count) گزارش می‌شوند.
// عنوان هر مرحله اینجا فقط مقدار پیش‌فرض است — هر تننت می‌تواند از طریق
// GET/PATCH /crm/funnel/stage-labels عنوان دلخواه خودش را جایگزین کند
// (خودِ مرحله و منطق محاسبه‌ی آن — یعنی کدام مخاطب در کدام مرحله است — تغییر
// نمی‌کند، فقط برچسب نمایشی؛ چون این سه پله‌ی دستی و دو پله‌ی خودکار به
// state machine واقعی FunnelService و کرون ریزش/سفیر برند گره خورده‌اند).
const MAIN_FUNNEL_STAGES = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'CUSTOMER', 'REPEAT_CUSTOMER'] as const;
const MAIN_FUNNEL_DEFAULT_LABELS: Record<string, string> = {
  NEW_LEAD: 'سرنخ جدید',
  CONTACTED: 'در تماس',
  QUALIFIED: 'واجد شرایط',
  CUSTOMER: 'مشتری (حداقل ۱ خرید)',
  REPEAT_CUSTOMER: 'خرید تکراری (حداقل ۲ خرید)',
};

const STAGE_LABELS_SETTING = { moduleCode: 'crm', key: 'funnelStageLabels' } as const;

@Injectable()
export class FunnelKpiService {
  /** برچسب فعلی هر مرحله‌ی اصلی — پیش‌فرض یا اگر تننت شخصی‌سازی کرده، همان. */
  async getStageLabels(ctx: TenantRequestContext): Promise<Record<string, string>> {
    const setting = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: STAGE_LABELS_SETTING } });
    const overrides = (setting?.value as Record<string, string> | undefined) ?? {};
    return Object.fromEntries(MAIN_FUNNEL_STAGES.map((s) => [s, overrides[s]?.trim() || MAIN_FUNNEL_DEFAULT_LABELS[s]]));
  }

  async setStageLabels(ctx: TenantRequestContext, labels: Record<string, string>): Promise<Record<string, string>> {
    const sanitized: Record<string, string> = {};
    for (const stage of MAIN_FUNNEL_STAGES) {
      const value = labels[stage]?.trim();
      if (value) sanitized[stage] = value;
    }
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: STAGE_LABELS_SETTING },
      create: { ...STAGE_LABELS_SETTING, value: sanitized },
      update: { value: sanitized },
    });
    return this.getStageLabels(ctx);
  }

  async getFunnelSummary(ctx: TenantRequestContext, scope: Record<string, unknown> = {}) {
    const stageLabels = await this.getStageLabels(ctx);
    const contacts = await ctx.tenantDb.crmContact.findMany({
      where: andWhere(scope, FUNNEL_PARTY_WHERE),
      select: {
        id: true,
        funnelStage: true,
        convertedAt: true,
        isBrandAmbassador: true,
        becameAmbassadorAt: true,
        purchaseCount: true,
        createdAt: true,
      },
    });
    const events = await ctx.tenantDb.crmFunnelStageEvent.findMany({
      where: { contact: andWhere(scope, FUNNEL_PARTY_WHERE) },
      select: { contactId: true, toStage: true },
    });

    const currentDistribution: Record<string, number> = Object.fromEntries(ALL_STAGES.map((s) => [s, 0]));
    for (const c of contacts) currentDistribution[c.funnelStage] = (currentDistribution[c.funnelStage] ?? 0) + 1;

    const contactedSet = new Set(events.filter((e) => e.toStage === 'CONTACTED').map((e) => e.contactId));
    const qualifiedSet = new Set(events.filter((e) => e.toStage === 'QUALIFIED').map((e) => e.contactId));

    // «تا کجا رسیده» تجمعی و یکنواخت است (computeReached) — همان تابعی که لیست کلیک روی مرحله
    // را می‌سازد، پس عدد قیف و فهرست هرگز نمی‌خوانند. سرنخی که مستقیم خرید کرده بدون
    // گلوگاه دستی رد شده و به مراحل پایین‌تر هم رسیده حساب می‌شود.
    const reached = computeReached(contacts, contactedSet, qualifiedSet);
    const stages = MAIN_FUNNEL_STAGES.map((stage) => ({
      stage,
      label: stageLabels[stage],
      count: reached[stage].size,
      // چند نفر «همین حالا» در همین مرحله‌اند (متفاوت از تجمعی)
      currentCount: currentDistribution[stage] ?? 0,
    }));

    const conversionRates: { fromStage: string; toStage: string; fromLabel: string; toLabel: string; rate: number | null }[] = [];
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1];
      const curr = stages[i];
      conversionRates.push({
        fromStage: prev.stage,
        toStage: curr.stage,
        fromLabel: prev.label,
        toLabel: curr.label,
        rate: prev.count > 0 ? Math.round((curr.count / prev.count) * 1000) / 10 : null,
      });
    }

    const validRates = conversionRates.filter((r) => r.rate !== null) as { fromStage: string; toStage: string; fromLabel: string; toLabel: string; rate: number }[];
    const bottleneck = validRates.length > 0 ? validRates.reduce((min, r) => (r.rate < min.rate ? r : min)) : null;

    const totalCustomers = contacts.filter(isConverted).length;
    const totalAmbassadors = contacts.filter((c) => c.isBrandAmbassador).length;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthCount = contacts.filter((c) => c.becameAmbassadorAt && c.becameAmbassadorAt >= thisMonthStart).length;
    const lastMonthCount = contacts.filter(
      (c) => c.becameAmbassadorAt && c.becameAmbassadorAt >= lastMonthStart && c.becameAmbassadorAt < thisMonthStart,
    ).length;

    return {
      stages,
      conversionRates,
      bottleneck,
      currentDistribution,
      ambassador: {
        totalAmbassadors,
        totalCustomers,
        ratioPercent: totalCustomers > 0 ? Math.round((totalAmbassadors / totalCustomers) * 1000) / 10 : 0,
        thisMonthCount,
        lastMonthCount,
        growthPercent:
          lastMonthCount > 0
            ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 1000) / 10
            : thisMonthCount > 0
              ? 100
              : 0,
        // طبق درخواست: بالای ۱۰٪ یعنی پتانسیل خوب برندسازی
        hasStrongBrandingPotential: totalCustomers > 0 && totalAmbassadors / totalCustomers >= 0.1,
      },
    };
  }

  /**
   * مخاطبین یک مرحله. mode=reached: همه‌ی کسانی که تا آن مرحله رسیده‌اند (مطابق عدد قیف)؛
   * mode=current: فقط کسانی که همین حالا در آن مرحله‌اند (کارت‌های سفیر/ریزش/خرید تکراری).
   */
  async listStageContacts(ctx: TenantRequestContext, scope: Record<string, unknown>, stage: string | undefined, mode: 'reached' | 'current') {
    const where = andWhere(scope, FUNNEL_PARTY_WHERE);
    const include = { owner: { select: { name: true } } };
    const isMain = (MAIN_FUNNEL_STAGES as readonly string[]).includes(stage ?? '');
    if (!stage || mode === 'current' || !isMain) {
      return ctx.tenantDb.crmContact.findMany({
        where: andWhere(where, stage ? { funnelStage: stage as never } : null),
        orderBy: { createdAt: 'desc' },
        include,
      });
    }
    const contacts = await ctx.tenantDb.crmContact.findMany({ where, orderBy: { createdAt: 'desc' }, include });
    if (stage === 'NEW_LEAD') return contacts;
    const events = await ctx.tenantDb.crmFunnelStageEvent.findMany({
      where: { contact: where, toStage: { in: ['CONTACTED', 'QUALIFIED'] } },
      select: { contactId: true, toStage: true },
    });
    const reached = computeReached(
      contacts,
      new Set(events.filter((e) => e.toStage === 'CONTACTED').map((e) => e.contactId)),
      new Set(events.filter((e) => e.toStage === 'QUALIFIED').map((e) => e.contactId)),
    );
    const ids = reached[stage as keyof typeof reached];
    return contacts.filter((c) => ids.has(c.id));
  }

  async getSalesKpis(ctx: TenantRequestContext, scope: Record<string, unknown> = {}) {
    const contacts = await ctx.tenantDb.crmContact.findMany({
      where: andWhere(scope, FUNNEL_PARTY_WHERE),
      select: { id: true, ownerUserId: true, source: true, acquisitionCost: true, purchaseCount: true, convertedAt: true, funnelStage: true, createdAt: true },
    });

    const withCost = contacts.filter((c) => c.acquisitionCost != null);
    const avgAcquisitionCost =
      withCost.length > 0
        ? Math.round(withCost.reduce((sum, c) => sum + (c.acquisitionCost ?? 0), 0) / withCost.length)
        : null;

    // بهترین منبع سرنخ بر اساس نرخ تبدیل به مشتری — منابع با کمتر از ۳ سرنخ
    // برای جلوگیری از نویز آماری کنار گذاشته می‌شوند.
    const bySource = new Map<string, { total: number; converted: number }>();
    for (const c of contacts) {
      const key = c.source?.trim() || null;
      if (!key) continue;
      const entry = bySource.get(key) ?? { total: 0, converted: 0 };
      entry.total++;
      if (isConverted(c)) entry.converted++;
      bySource.set(key, entry);
    }
    const sourcePerformance = [...bySource.entries()]
      .map(([source, { total, converted }]) => ({
        source,
        totalLeads: total,
        convertedCount: converted,
        conversionRate: Math.round((converted / total) * 1000) / 10,
      }))
      .sort((a, b) => b.conversionRate - a.conversionRate);
    const bestSource = sourcePerformance.find((s) => s.totalLeads >= 3) ?? sourcePerformance[0] ?? null;

    // میانگین زمان پیگیری: از لحظه‌ی ثبت سرنخ تا اولین تماس/جلسه/ایمیل واقعی
    const activities = await ctx.tenantDb.crmActivity.findMany({
      where: { type: { in: ['CALL', 'MEETING', 'EMAIL'] }, contactId: { not: null }, contact: andWhere(scope, FUNNEL_PARTY_WHERE) },
      orderBy: { createdAt: 'asc' },
      select: { contactId: true, createdAt: true },
    });
    const firstActivityByContact = new Map<string, Date>();
    for (const a of activities) {
      if (a.contactId && !firstActivityByContact.has(a.contactId)) firstActivityByContact.set(a.contactId, a.createdAt);
    }
    const contactsById = new Map(contacts.map((c) => [c.id, c]));
    let totalHours = 0;
    let followUpSamples = 0;
    for (const [contactId, firstAt] of firstActivityByContact) {
      const contact = contactsById.get(contactId);
      if (!contact) continue;
      totalHours += (firstAt.getTime() - contact.createdAt.getTime()) / (60 * 60 * 1000);
      followUpSamples++;
    }
    const avgFollowUpHours = followUpSamples > 0 ? Math.round((totalHours / followUpSamples) * 10) / 10 : null;

    // عملکرد کارشناس‌های فروش
    const byOwner = new Map<string, { total: number; converted: number }>();
    for (const c of contacts) {
      if (!c.ownerUserId) continue;
      const entry = byOwner.get(c.ownerUserId) ?? { total: 0, converted: 0 };
      entry.total++;
      if (isConverted(c)) entry.converted++;
      byOwner.set(c.ownerUserId, entry);
    }
    const ownerIds = [...byOwner.keys()];
    const owners = ownerIds.length > 0 ? await ctx.tenantDb.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
    const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));
    const salespeople = ownerIds
      .map((id) => {
        const { total, converted } = byOwner.get(id)!;
        return {
          userId: id,
          name: ownerNameById.get(id) ?? 'نامشخص',
          totalLeads: total,
          convertedCount: converted,
          conversionRate: Math.round((converted / total) * 1000) / 10,
        };
      })
      .sort((a, b) => b.conversionRate - a.conversionRate);

    return { avgAcquisitionCost, bestSource, sourcePerformance, avgFollowUpHours, salespeople };
  }
}
