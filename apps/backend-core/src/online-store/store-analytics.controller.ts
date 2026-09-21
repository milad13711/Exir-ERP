import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';

const ABANDONED_CART_WINDOW_MS = 2 * 60 * 60 * 1000; // ۲ ساعت بدون تکمیل سفارش = سبد رهاشده

@Controller('online-store/analytics')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('online-store')
export class StoreAnalyticsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('summary')
  async summary(@Query('days') daysParam: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'online-store');
    const days = Math.min(Math.max(Number(daysParam) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [visitEvents, productViewEvents, dwellEvents, addToCartEvents, orderedSessions, orders] = await Promise.all([
      ctx.tenantDb.storeAnalyticsEvent.findMany({
        where: { type: 'PAGE_VIEW', occurredAt: { gte: since } },
        select: { sessionToken: true },
      }),
      ctx.tenantDb.storeAnalyticsEvent.findMany({
        where: { type: 'PRODUCT_VIEW', occurredAt: { gte: since } },
        select: { productId: true },
      }),
      ctx.tenantDb.storeAnalyticsEvent.findMany({
        where: { type: 'PRODUCT_DWELL', occurredAt: { gte: since } },
        select: { productId: true, meta: true },
      }),
      ctx.tenantDb.storeAnalyticsEvent.findMany({
        where: { type: 'ADD_TO_CART', occurredAt: { gte: since } },
        select: { sessionToken: true, occurredAt: true },
      }),
      ctx.tenantDb.storeAnalyticsEvent.findMany({
        where: { type: 'ORDER_PLACED', occurredAt: { gte: since } },
        select: { sessionToken: true },
      }),
      ctx.tenantDb.storeOrder.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, subtotal: true },
      }),
    ]);

    const uniqueVisitors = new Set(visitEvents.map((e) => e.sessionToken)).size;

    const viewCounts = new Map<string, number>();
    for (const e of productViewEvents) {
      if (!e.productId) continue;
      viewCounts.set(e.productId, (viewCounts.get(e.productId) ?? 0) + 1);
    }
    const dwellTotals = new Map<string, { sum: number; count: number }>();
    for (const e of dwellEvents) {
      if (!e.productId) continue;
      const seconds = Number((e.meta as Record<string, unknown> | null)?.seconds ?? 0);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const entry = dwellTotals.get(e.productId) ?? { sum: 0, count: 0 };
      entry.sum += seconds;
      entry.count += 1;
      dwellTotals.set(e.productId, entry);
    }
    const productIds = [...new Set([...viewCounts.keys(), ...dwellTotals.keys()])];
    const products = productIds.length
      ? await ctx.tenantDb.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const mostViewed = [...viewCounts.entries()]
      .map(([productId, views]) => {
        const dwell = dwellTotals.get(productId);
        return {
          productId,
          name: productById.get(productId)?.name ?? 'کالای حذف‌شده',
          views,
          avgDwellSeconds: dwell ? Math.round(dwell.sum / dwell.count) : null,
        };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // سبد رهاشده: سشنی که کالا به سبد اضافه کرده، سفارشی ثبت نکرده، و از
    // آخرین فعالیتش دست‌کم ۲ ساعت گذشته (هنوز ممکن است در حال خرید باشد).
    const orderedSessionSet = new Set(orderedSessions.map((e) => e.sessionToken));
    const lastActivityBySession = new Map<string, number>();
    for (const e of addToCartEvents) {
      const t = new Date(e.occurredAt).getTime();
      const prev = lastActivityBySession.get(e.sessionToken) ?? 0;
      if (t > prev) lastActivityBySession.set(e.sessionToken, t);
    }
    const cutoff = Date.now() - ABANDONED_CART_WINDOW_MS;
    let abandonedCarts = 0;
    for (const [session, lastActivity] of lastActivityBySession) {
      if (!orderedSessionSet.has(session) && lastActivity < cutoff) abandonedCarts++;
    }

    const ordersByStatus: Record<string, number> = {};
    let revenue = 0;
    for (const o of orders) {
      ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
      if (o.status !== 'CANCELLED') revenue += o.subtotal;
    }

    return {
      periodDays: days,
      uniqueVisitors,
      totalOrders: orders.length,
      revenue,
      ordersByStatus,
      abandonedCarts,
      mostViewedProducts: mostViewed,
    };
  }
}
