import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { FUNNEL_STAGES, type FunnelStage } from './agent-constants.js';
import { isManualTransitionAllowed } from './agent-funnel.js';

/** دامنه‌ی داده: کدام عضویت‌ها دیده شوند. نماینده فقط عضویت‌های خودش؛ ادمین هر ترکیبی. */
export type CustomerScope = { membershipIds?: string[]; productId?: string; profileId?: string };

function whereOf(scope: CustomerScope): Prisma.AgentCustomerWhereInput {
  const w: Prisma.AgentCustomerWhereInput = {};
  if (scope.membershipIds) w.membershipId = { in: scope.membershipIds };
  if (scope.productId) w.productId = scope.productId;
  if (scope.profileId) w.membership = { resellerProfileId: scope.profileId };
  return w;
}

export type CustomerFilters = { stage?: string; status?: string; q?: string; take?: number; cursor?: string };

@Injectable()
export class AgentCustomersService {
  async list(ctx: TenantRequestContext, scope: CustomerScope, f: CustomerFilters = {}) {
    const q = f.q?.trim();
    const take = Math.min(Math.max(f.take ?? 100, 1), 200);
    const rows = await ctx.tenantDb.agentCustomer.findMany({
      where: {
        ...whereOf(scope),
        ...(f.stage && (FUNNEL_STAGES as readonly string[]).includes(f.stage) ? { funnelStage: f.stage } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { externalCustomerId: { contains: q } }] } : {}),
      },
      // شماره‌ی کامل مشتری برای نماینده نمایش داده می‌شود (تصمیم مالک)
      select: {
        id: true, productId: true, membershipId: true, externalCustomerId: true, name: true, phone: true, email: true, planCode: true, planName: true,
        status: true, funnelStage: true, registeredAt: true, lastPaymentAt: true, nextRenewalAt: true, cancelledAt: true,
        product: { select: { code: true, name: true } },
      },
      orderBy: [{ registeredAt: 'desc' }, { id: 'asc' }],
      take: take + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    return { items: hasMore ? rows.slice(0, take) : rows, nextCursor: hasMore ? rows[take - 1]!.id : null };
  }

  /** مشتری داخل دامنه یا ۴۰۴ (مرز جداسازی نماینده/محصول). */
  async getInScope(ctx: TenantRequestContext, scope: CustomerScope, id: string) {
    const c = await ctx.tenantDb.agentCustomer.findFirst({
      where: { id, ...whereOf(scope) },
      include: { product: { select: { code: true, name: true } }, stageLogs: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    if (!c) throw new NotFoundException('مشتری یافت نشد');
    return c;
  }

  async payments(ctx: TenantRequestContext, scope: CustomerScope, f: { customerId?: string; take?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(f.take ?? 100, 1), 200);
    const rows = await ctx.tenantDb.agentPaymentEvent.findMany({
      where: {
        customer: whereOf(scope),
        ...(f.customerId ? { customerId: f.customerId } : {}),
      },
      include: { customer: { select: { name: true, externalCustomerId: true, product: { select: { code: true, name: true } } } } },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
      take: take + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    return { items: hasMore ? rows.slice(0, take) : rows, nextCursor: hasMore ? rows[take - 1]!.id : null };
  }

  /** فرصت‌های تمدید: مشتریان فعال که پایان دوره‌شان در `withinDays` روز آینده است (یا گذشته‌ی نزدیک تا 14 روز). */
  async renewals(ctx: TenantRequestContext, scope: CustomerScope, withinDays = 60) {
    const now = Date.now();
    return ctx.tenantDb.agentCustomer.findMany({
      where: {
        ...whereOf(scope),
        status: 'ACTIVE',
        nextRenewalAt: { gte: new Date(now - 14 * 86_400_000), lte: new Date(now + withinDays * 86_400_000) },
      },
      select: { id: true, name: true, phone: true, planName: true, funnelStage: true, nextRenewalAt: true, lastPaymentAt: true, product: { select: { code: true, name: true } } },
      orderBy: { nextRenewalAt: 'asc' },
      take: 300,
    });
  }

  /** خلاصه‌ی قیف: تعداد در هر مرحله + جمع فروش خالص (پرداخت − بازپرداخت). */
  async funnelSummary(ctx: TenantRequestContext, scope: CustomerScope) {
    const where = whereOf(scope);
    // فروش از دفتر مرکزی تراکنش‌ها، به نماینده‌ای که در لحظه‌ی تراکنش مالک مشتری بود (انتقال بعدی سوابق را جابه‌جا نمی‌کند)
    let membershipIds = scope.membershipIds;
    if (!membershipIds && scope.profileId) {
      membershipIds = (await ctx.tenantDb.agentProductMembership.findMany({ where: { resellerProfileId: scope.profileId }, select: { id: true } })).map((m) => m.id);
    }
    const txWhere: Prisma.AgentTransactionWhereInput = {
      ...(scope.productId ? { productId: scope.productId } : {}),
      ...(membershipIds ? { membershipId: { in: membershipIds } } : { membershipId: { not: null } }),
    };
    const [stages, pay] = await Promise.all([
      ctx.tenantDb.agentCustomer.groupBy({ by: ['funnelStage'], where, _count: true }),
      ctx.tenantDb.agentTransaction.groupBy({ by: ['occurrence'], where: txWhere, _sum: { netAmount: true }, _count: true }),
    ]);
    const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
    for (const s of stages) if (s.funnelStage in counts) counts[s.funnelStage as FunnelStage] = s._count;
    const sold = pay.filter((p) => p.occurrence !== 'REFUND').reduce((a, p) => a + (p._sum.netAmount ?? 0), 0);
    const refunded = pay.filter((p) => p.occurrence === 'REFUND').reduce((a, p) => a + (p._sum.netAmount ?? 0), 0);
    return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), netSales: sold - refunded, paymentCount: pay.filter((p) => p.occurrence !== 'REFUND').reduce((a, p) => a + p._count, 0) };
  }

  /** تغییر دستی مرحله‌ی قیف (فقط ادمین) با ثبت سابقه. */
  async changeStage(ctx: TenantRequestContext, customerId: string, stage: string, note?: string) {
    const c = await ctx.tenantDb.agentCustomer.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException('مشتری یافت نشد');
    if (!isManualTransitionAllowed(c.funnelStage, stage, FUNNEL_STAGES)) throw new BadRequestException('مرحله‌ی انتخاب‌شده نامعتبر یا همان مرحله‌ی فعلی است');
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    await ctx.tenantDb.agentCustomer.update({ where: { id: customerId }, data: { funnelStage: stage } });
    await ctx.tenantDb.agentCustomerStageLog.create({ data: { customerId, fromStage: c.funnelStage, toStage: stage, source: 'MANUAL', byUserId: userId, note } });
    return { success: true };
  }

  // ── لاگ رویدادهای API (ادمین) ─────────────────────────────
  async eventLogs(ctx: TenantRequestContext, f: { productId?: string; status?: string; type?: string; q?: string; from?: string; to?: string; take?: number; cursor?: string }) {
    const take = Math.min(Math.max(f.take ?? 100, 1), 200);
    const createdAt: Prisma.DateTimeFilter = {};
    if (f.from && !Number.isNaN(Date.parse(f.from))) createdAt.gte = new Date(f.from);
    if (f.to && !Number.isNaN(Date.parse(f.to))) createdAt.lte = new Date(f.to);
    const rows = await ctx.tenantDb.agentApiEventLog.findMany({
      where: {
        ...(f.productId ? { productId: f.productId } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.type ? { type: f.type } : {}),
        ...(f.q ? { OR: [{ clientEventId: { contains: f.q } }, { message: { contains: f.q, mode: 'insensitive' } }, { errorCode: { contains: f.q, mode: 'insensitive' } }] } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: take + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    return { items: hasMore ? rows.slice(0, take) : rows, nextCursor: hasMore ? rows[take - 1]!.id : null };
  }
}
