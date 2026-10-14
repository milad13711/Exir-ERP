import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { getManagerUsers } from '../common/manager-users.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DispatchRulesService } from './dispatch-rules.service.js';
import { decideSourceAction, resolveStagesBeforeEnd, shouldSuggestForProduction, type SuggestionSourceType } from './dispatch-suggestions.js';
import { dedupe } from './dispatch-common.js';

export const SOURCE_TYPES: SuggestionSourceType[] = ['PRODUCTION_ORDER', 'SALES_INVOICE', 'STOCK_MOVEMENT'];

/** پیشنهاد «اعلام بار» از دستور تولید / فاکتور / حواله خروج — یکتا به‌ازای هر منبع (DispatchSuggestion). */
@Injectable()
export class DispatchSuggestionsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly rules: DispatchRulesService,
    private readonly notifications: NotificationsService,
  ) {}

  assertType(type: string): SuggestionSourceType {
    if (!SOURCE_TYPES.includes(type as SuggestionSourceType)) throw new BadRequestException('نوع منبع نامعتبر است');
    return type as SuggestionSourceType;
  }

  /** بارهای فعال (غیرلغو) ثبت‌شده برای یک منبع. */
  async liveShipmentsFor(ctx: TenantRequestContext, type: SuggestionSourceType, id: string) {
    const where =
      type === 'SALES_INVOICE' ? { sourceInvoiceId: id } : type === 'STOCK_MOVEMENT' ? { sourceStockMovementId: id } : { loading: { productionOrderId: id } };
    return ctx.tenantDb.shipment.findMany({ where: { ...where, status: { not: 'CANCELLED' } }, select: { id: true, status: true, shipmentNo: true }, orderBy: { createdAt: 'desc' } });
  }

  async productionFacts(ctx: TenantRequestContext, orderId: string) {
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id: orderId }, include: { stages: { select: { status: true } } } });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');
    const settings = await this.rules.getSettings(ctx.tenantDb);
    const override = await ctx.tenantDb.dispatchProductionTrigger.findUnique({ where: { productionOrderId: orderId } });
    const stagesBeforeEnd = resolveStagesBeforeEnd(override?.stagesBeforeEnd, settings.productionTrigger.stagesBeforeEnd);
    const doneStages = order.stages.filter((s) => s.status === 'DONE').length;
    return {
      order,
      enabled: settings.productionTrigger.enabled,
      override: override?.stagesBeforeEnd ?? null,
      tenantDefault: settings.productionTrigger.stagesBeforeEnd,
      stagesBeforeEnd,
      totalStages: order.stages.length,
      doneStages,
      suggested: shouldSuggestForProduction({ status: order.status, totalStages: order.stages.length, doneStages, stagesBeforeEnd }),
    };
  }

  /** وضعیت منبع برای نمایش بنر/دکمه‌ی «اعلام بار» در صفحه‌های تولید، فروش و انبار. */
  async sourceStatus(ctx: TenantRequestContext, typeRaw: string, id: string) {
    const type = this.assertType(typeRaw);
    const live = await this.liveShipmentsFor(ctx, type, id);
    const decision = decideSourceAction(live);
    const suggestion = await ctx.tenantDb.dispatchSuggestion.findUnique({ where: { sourceType_sourceId: { sourceType: type, sourceId: id } } });
    let suggested = false;
    let production: Record<string, unknown> | null = null;
    if (type === 'PRODUCTION_ORDER') {
      const f = await this.productionFacts(ctx, id);
      suggested = f.enabled && f.suggested && suggestion?.status !== 'DISMISSED';
      production = { stagesBeforeEnd: f.stagesBeforeEnd, override: f.override, tenantDefault: f.tenantDefault, totalStages: f.totalStages, doneStages: f.doneStages, enabled: f.enabled };
    } else {
      suggested = suggestion?.status !== 'DISMISSED';
    }
    return {
      sourceType: type,
      sourceId: id,
      suggested: decision.action === 'CREATE' && suggested,
      existing: decision.action === 'EXISTS' ? decision.shipment : null,
      dismissed: suggestion?.status === 'DISMISSED',
      production,
    };
  }

  async dismiss(ctx: TenantRequestContext, typeRaw: string, id: string) {
    const type = this.assertType(typeRaw);
    await ctx.tenantDb.dispatchSuggestion.upsert({
      where: { sourceType_sourceId: { sourceType: type, sourceId: id } },
      update: { status: 'DISMISSED' },
      create: { sourceType: type, sourceId: id, status: 'DISMISSED' },
    });
    return { success: true };
  }

  async setProductionTrigger(ctx: TenantRequestContext, orderId: string, stagesBeforeEnd: number | null) {
    if (!(await ctx.tenantDb.productionOrder.findUnique({ where: { id: orderId }, select: { id: true } }))) throw new NotFoundException('دستور تولید یافت نشد');
    if (stagesBeforeEnd === null) {
      await ctx.tenantDb.dispatchProductionTrigger.deleteMany({ where: { productionOrderId: orderId } });
    } else {
      if (!Number.isInteger(stagesBeforeEnd) || stagesBeforeEnd < 0 || stagesBeforeEnd > 20) throw new BadRequestException('تعداد مرحله باید عدد صحیح بین ۰ تا ۲۰ باشد');
      await ctx.tenantDb.dispatchProductionTrigger.upsert({
        where: { productionOrderId: orderId },
        update: { stagesBeforeEnd },
        create: { productionOrderId: orderId, stagesBeforeEnd },
      });
    }
    // تغییر ماشه، رد قبلی را بی‌اثر می‌کند
    await ctx.tenantDb.dispatchSuggestion.updateMany({ where: { sourceType: 'PRODUCTION_ORDER', sourceId: orderId, status: 'DISMISSED' }, data: { status: 'OPEN' } });
    return this.sourceStatus(ctx, 'PRODUCTION_ORDER', orderId);
  }

  /** ادعای اتمیک منبع برای ساخت بار (ضدتکرار با یکتایی (type,id)). false = کس دیگری همین الان ساخته. */
  async claim(ctx: TenantRequestContext, type: SuggestionSourceType, id: string, title?: string): Promise<boolean> {
    await ctx.tenantDb.dispatchSuggestion
      .create({ data: { sourceType: type, sourceId: id, status: 'OPEN', title } })
      .catch(() => undefined); // قبلاً بوده
    const res = await ctx.tenantDb.dispatchSuggestion.updateMany({
      where: { sourceType: type, sourceId: id, status: { in: ['OPEN', 'DISMISSED'] } },
      data: { status: 'CREATED' },
    });
    return res.count > 0;
  }

  async attach(ctx: TenantRequestContext, type: SuggestionSourceType, id: string, shipmentId: string) {
    await ctx.tenantDb.dispatchSuggestion.updateMany({ where: { sourceType: type, sourceId: id }, data: { shipmentId } });
  }

  /** بعد از شکست ساخت یا لغو بار: منبع دوباره آزاد می‌شود. */
  async release(ctx: TenantRequestContext, type: SuggestionSourceType, id: string) {
    await ctx.tenantDb.dispatchSuggestion.updateMany({ where: { sourceType: type, sourceId: id, status: 'CREATED' }, data: { status: 'OPEN', shipmentId: null } });
  }

  /** اسکن دوره‌ای دستورهای تولید و ارسال اعلان یک‌باره‌ی «زمان اعلام بار». */
  async scanProduction(ctx: TenantRequestContext): Promise<number> {
    const settings = await this.rules.getSettings(ctx.tenantDb);
    if (!settings.productionTrigger.enabled) return 0;
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const orders = await ctx.tenantDb.productionOrder.findMany({
      where: { OR: [{ status: { in: ['IN_PROGRESS', 'QC_PENDING'] } }, { status: 'COMPLETED', actualEndAt: { gte: since } }] },
      select: { id: true, orderNo: true, createdByUserId: true, status: true, stages: { select: { status: true } }, bom: { select: { outputProductId: true } } },
      take: 300,
    });
    if (orders.length === 0) return 0;
    const overrides = await ctx.tenantDb.dispatchProductionTrigger.findMany({ where: { productionOrderId: { in: orders.map((o) => o.id) } } });
    const overrideById = new Map(overrides.map((o) => [o.productionOrderId, o.stagesBeforeEnd]));
    let notified = 0;
    for (const o of orders) {
      const stagesBeforeEnd = resolveStagesBeforeEnd(overrideById.get(o.id), settings.productionTrigger.stagesBeforeEnd);
      const suggested = shouldSuggestForProduction({
        status: o.status,
        totalStages: o.stages.length,
        doneStages: o.stages.filter((s) => s.status === 'DONE').length,
        stagesBeforeEnd,
      });
      if (!suggested) continue;
      const live = await this.liveShipmentsFor(ctx, 'PRODUCTION_ORDER', o.id);
      if (live.length > 0) continue;
      let row = await ctx.tenantDb.dispatchSuggestion.findUnique({ where: { sourceType_sourceId: { sourceType: 'PRODUCTION_ORDER', sourceId: o.id } } });
      if (!row) {
        row = await ctx.tenantDb.dispatchSuggestion
          .create({ data: { sourceType: 'PRODUCTION_ORDER', sourceId: o.id, title: `دستور تولید ${o.orderNo}` } })
          .catch(() => null as never);
        if (!row) continue;
      }
      if (row.status !== 'OPEN' || row.notifiedAt) continue;
      // علامت‌گذاری اتمیک تا دو اجرای همزمان اعلان تکراری نفرستند
      const mark = await ctx.tenantDb.dispatchSuggestion.updateMany({ where: { id: row.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
      if (mark.count === 0) continue;
      const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
      const recipients = dedupe([...managers.map((m) => m.tenantUserId), ...(o.createdByUserId ? [o.createdByUserId] : [])]);
      for (const userId of recipients) {
        await this.notifications
          .notify(ctx.tenantDb, {
            userId,
            type: 'dispatch.suggestion',
            title: `زمان اعلام بار برای دستور تولید ${o.orderNo} رسیده است`,
            body: 'برای فراخوان راننده، از صفحه‌ی دستور تولید «اعلام بار» را بزنید.',
            link: '/production',
          })
          .catch(() => undefined);
      }
      notified++;
    }
    return notified;
  }
}
