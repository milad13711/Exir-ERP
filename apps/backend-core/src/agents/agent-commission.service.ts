import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { commissionAmount, isRuleActiveAt, pickPlanRule, specificity, walletSummary, type TxOccurrence } from './agent-commission.js';
import type { CreatePlanRuleDto, RenameCatalogDto, TransferCustomerDto } from './dto/commission.dto.js';

const MAX_TAKE = 200;
/** اجازه‌ی کمی عقب‌تر از «الان» برای اختلاف ساعت مرورگر؛ قانون هرگز به‌طور واقعی گذشته‌نگر نمی‌شود. */
const PAST_TOLERANCE_MS = 5 * 60_000;

export type TxFilter = {
  productId?: string;
  membershipIds?: string[];
  txType?: string;
  itemCode?: string;
  commissionStatus?: string;
  occurrence?: string;
  from?: string;
  to?: string;
  q?: string;
  take?: number;
  cursor?: string;
};

function dateOrUndef(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** قوانین پورسانت، کاتالوگ تراکنش‌ها، دفتر مرکزی تراکنش‌ها، کیف پول و انتقال مشتری. */
@Injectable()
export class AgentCommissionService {
  private async product(ctx: TenantRequestContext, productId: string) {
    const p = await ctx.tenantDb.agentProduct.findUnique({ where: { id: productId } });
    if (!p) throw new NotFoundException('محصول یافت نشد');
    return p;
  }

  // ── قوانین ───────────────────────────────────────────────
  async listPlanRules(ctx: TenantRequestContext, productId: string, includeEnded: boolean) {
    await this.product(ctx, productId);
    const now = new Date();
    const rows = await ctx.tenantDb.agentCommissionPlanRule.findMany({
      where: { productId, ...(includeEnded ? {} : { OR: [{ endedAt: null }, { endedAt: { gt: now } }] }) },
      orderBy: [{ level: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rows.map((r) => ({ ...r, state: isRuleActiveAt(r, now) ? 'ACTIVE' : r.effectiveFrom.getTime() > now.getTime() ? 'SCHEDULED' : 'ENDED', specificity: specificity(r) }));
  }

  /**
   * قانون تازه. اگر قانونی با همان کلید (سطح، نوع، قلم، دفعه) هنوز باز است، از لحظه‌ی شروع قانون جدید بسته می‌شود
   * (نسخه‌ی تازه جایگزین می‌شود؛ تراکنش‌های گذشته snapshot خودشان را دارند).
   */
  async createPlanRule(ctx: TenantRequestContext, productId: string, dto: CreatePlanRuleDto) {
    await this.product(ctx, productId);
    const now = new Date();
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : now;
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('تاریخ شروع اعتبار نامعتبر است');
    if (effectiveFrom.getTime() < now.getTime() - PAST_TOLERANCE_MS) throw new BadRequestException('قانون فقط از الان یا آینده اعمال می‌شود؛ تاریخ گذشته مجاز نیست');
    const percent = Math.round(dto.percent * 100) / 100;
    const txTypeCode = dto.txTypeCode?.trim().toUpperCase() || null;
    const itemCode = dto.itemCode?.trim() || null;
    const occurrence = dto.occurrence ?? 'ANY';
    const by = await resolveTenantUserId(ctx).catch(() => null);
    return ctx.tenantDb.$transaction(async (tx) => {
      const open = await tx.agentCommissionPlanRule.findMany({
        where: { productId, level: dto.level, txTypeCode, itemCode, occurrence, OR: [{ endedAt: null }, { endedAt: { gt: effectiveFrom } }] },
      });
      // قانونِ زمان‌بندی‌شده‌ی آینده با همین کلید که بعد از شروع این یکی است، معنا ندارد — جلوی سردرگمی را می‌گیریم
      if (open.some((r) => r.effectiveFrom.getTime() > effectiveFrom.getTime())) throw new ConflictException('برای همین ترکیب یک قانون زمان‌بندی‌شده‌ی بعدی وجود دارد؛ اول آن را لغو کنید');
      for (const r of open) await tx.agentCommissionPlanRule.update({ where: { id: r.id }, data: { endedAt: effectiveFrom } });
      const created = await tx.agentCommissionPlanRule.create({
        data: { productId, level: dto.level, txTypeCode, itemCode, occurrence, percent, effectiveFrom, note: dto.note?.trim() || null, replacesRuleId: open[0]?.id ?? null, createdByUserId: by },
      });
      await tx.agentAuditLog.create({
        data: { action: 'commission_rule.created', detail: `${productId} ${dto.level} ${txTypeCode ?? '*'} ${itemCode ?? '*'} ${occurrence} ${percent}%${open.length ? ` (جایگزین ${open.length})` : ''}`, actorUserId: by },
      });
      return created;
    });
  }

  /** پایان قانون از همین لحظه (حذف نمی‌شود؛ پورسانت‌های گذشته به آن ارجاع دارند). قانون زمان‌بندی‌شده‌ی آینده کاملاً لغو می‌شود. */
  async endPlanRule(ctx: TenantRequestContext, productId: string, ruleId: string) {
    const r = await ctx.tenantDb.agentCommissionPlanRule.findFirst({ where: { id: ruleId, productId } });
    if (!r) throw new NotFoundException('قانون یافت نشد');
    const now = new Date();
    if (r.endedAt && r.endedAt.getTime() <= now.getTime()) return r;
    const endedAt = r.effectiveFrom.getTime() > now.getTime() ? r.effectiveFrom : now;
    const by = await resolveTenantUserId(ctx).catch(() => null);
    await ctx.tenantDb.agentAuditLog.create({ data: { action: 'commission_rule.ended', detail: ruleId, actorUserId: by } });
    return ctx.tenantDb.agentCommissionPlanRule.update({ where: { id: r.id }, data: { endedAt } });
  }

  /** قوانین فعال/زمان‌بندی‌شده‌ی یک سطح در یک محصول — دید فقط‌خواندنی خودِ نماینده (بدون یادداشت داخلی ادمین). */
  async rulesForLevel(ctx: TenantRequestContext, productId: string, level: string) {
    const now = new Date();
    const [rules, cat] = await Promise.all([
      ctx.tenantDb.agentCommissionPlanRule.findMany({ where: { productId, level, OR: [{ endedAt: null }, { endedAt: { gt: now } }] }, orderBy: { effectiveFrom: 'asc' } }),
      this.catalog(ctx, productId),
    ]);
    const tName = new Map(cat.types.map((t) => [t.code, t.name]));
    const iName = new Map(cat.items.map((t) => [t.code, t.name]));
    return rules.map((r) => ({
      id: r.id,
      txTypeCode: r.txTypeCode,
      txTypeName: r.txTypeCode ? (tName.get(r.txTypeCode) ?? r.txTypeCode) : null,
      itemCode: r.itemCode,
      itemName: r.itemCode ? (iName.get(r.itemCode) ?? r.itemCode) : null,
      occurrence: r.occurrence,
      percent: r.percent,
      effectiveFrom: r.effectiveFrom,
      endedAt: r.endedAt,
      state: isRuleActiveAt(r, now) ? 'ACTIVE' : 'SCHEDULED',
    }));
  }

  /** «اگر الان این تراکنش بیاید، کدام قانون و چه درصدی؟» — برای اطمینان ادمین پیش از ذخیره. */
  async simulate(ctx: TenantRequestContext, productId: string, q: { level: string; txType: string; itemCode?: string; occurrence?: string; amount?: number }) {
    await this.product(ctx, productId);
    const rules = await ctx.tenantDb.agentCommissionPlanRule.findMany({ where: { productId, level: q.level } });
    const occurrence = (q.occurrence?.toUpperCase() || 'FIRST') as TxOccurrence;
    const rule = pickPlanRule(rules, { level: q.level, txTypeCode: q.txType.toUpperCase(), itemCode: q.itemCode || null, occurrence, at: new Date() });
    const amount = q.amount && rule ? commissionAmount(Math.floor(q.amount), rule.percent) : 0;
    return { rule, commission: amount };
  }

  // ── کاتالوگ ─────────────────────────────────────────────
  async catalog(ctx: TenantRequestContext, productId: string) {
    await this.product(ctx, productId);
    const [types, items] = await Promise.all([
      ctx.tenantDb.agentTransactionType.findMany({ where: { productId }, orderBy: { code: 'asc' } }),
      ctx.tenantDb.agentTransactionItem.findMany({ where: { productId }, orderBy: { code: 'asc' } }),
    ]);
    return { types, items };
  }

  /** کد نوع/قلم را می‌توان پیش از اولین تراکنش هم تعریف کرد تا قانونش آماده باشد. */
  async upsertCatalog(ctx: TenantRequestContext, productId: string, kind: 'type' | 'item', dto: RenameCatalogDto & { code: string }) {
    await this.product(ctx, productId);
    const code = kind === 'type' ? dto.code.trim().toUpperCase() : dto.code.trim();
    if (!/^[A-Za-z0-9._:\-]{2,60}$/.test(code)) throw new BadRequestException('کد فقط حروف لاتین، عدد و . _ : - (۲ تا ۶۰ نویسه)');
    const data = { ...(dto.name !== undefined ? { name: dto.name.trim() || code } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) };
    const where = { productId_code: { productId, code } };
    return kind === 'type'
      ? ctx.tenantDb.agentTransactionType.upsert({ where, create: { productId, code, name: dto.name?.trim() || code, isActive: dto.isActive ?? true }, update: data })
      : ctx.tenantDb.agentTransactionItem.upsert({ where, create: { productId, code, name: dto.name?.trim() || code, isActive: dto.isActive ?? true }, update: data });
  }

  // ── دفتر مرکزی تراکنش‌ها ───────────────────────────────
  async transactions(ctx: TenantRequestContext, f: TxFilter) {
    const take = Math.min(Math.max(f.take ?? 50, 1), MAX_TAKE);
    const from = dateOrUndef(f.from);
    const to = dateOrUndef(f.to);
    const where: Prisma.AgentTransactionWhereInput = {
      ...(f.productId ? { productId: f.productId } : {}),
      ...(f.membershipIds ? { membershipId: { in: f.membershipIds } } : {}),
      ...(f.txType ? { txTypeCode: f.txType.toUpperCase() } : {}),
      ...(f.itemCode ? { itemCode: f.itemCode } : {}),
      ...(f.commissionStatus ? { commissionStatus: f.commissionStatus } : {}),
      ...(f.occurrence ? { occurrence: f.occurrence } : {}),
      ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(f.q ? { OR: [{ externalTxId: { contains: f.q } }, { externalCustomerId: { contains: f.q } }, { itemName: { contains: f.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, totals] = await Promise.all([
      ctx.tenantDb.agentTransaction.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
        include: { commissions: { select: { id: true, membershipId: true, amount: true, percent: true, kind: true, availableAt: true, ruleId: true } } },
      }),
      ctx.tenantDb.agentTransaction.groupBy({ by: ['occurrence'], where, _sum: { netAmount: true }, _count: true }),
    ]);
    const commissionSum = await ctx.tenantDb.agentCommission.aggregate({ _sum: { amount: true }, where: { transaction: where } });
    const page = rows.slice(0, take);
    // نام نماینده و مشتری برای نمایش
    const mIds = [...new Set(page.map((r) => r.membershipId).filter((x): x is string => !!x))];
    const cIds = [...new Set(page.map((r) => r.customerId).filter((x): x is string => !!x))];
    const [ms, cs] = await Promise.all([
      mIds.length ? ctx.tenantDb.agentProductMembership.findMany({ where: { id: { in: mIds } }, select: { id: true, resellerProfile: { select: { contact: { select: { name: true } } } } } }) : [],
      cIds.length ? ctx.tenantDb.agentCustomer.findMany({ where: { id: { in: cIds } }, select: { id: true, name: true } }) : [],
    ]);
    const mName = new Map(ms.map((m) => [m.id, m.resellerProfile.contact.name]));
    const cName = new Map(cs.map((c) => [c.id, c.name]));
    return {
      items: page.map((r) => ({ ...r, agentName: r.membershipId ? (mName.get(r.membershipId) ?? null) : null, customerName: r.customerId ? (cName.get(r.customerId) ?? null) : null })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
      totals: {
        byOccurrence: totals.map((t) => ({ occurrence: t.occurrence, count: t._count, net: t._sum.netAmount ?? 0 })),
        commission: commissionSum._sum.amount ?? 0,
      },
    };
  }

  // ── کیف پول ─────────────────────────────────────────────
  async wallet(ctx: TenantRequestContext, membershipId: string, q: { take?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(q.take ?? 50, 1), MAX_TAKE);
    const [all, payouts, rows] = await Promise.all([
      ctx.tenantDb.agentCommission.findMany({ where: { membershipId }, select: { amount: true, availableAt: true } }),
      ctx.tenantDb.agentPayout.findMany({ where: { membershipId }, select: { amount: true, status: true } }),
      ctx.tenantDb.agentCommission.findMany({
        where: { membershipId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: { transaction: { select: { externalTxId: true, txTypeCode: true, itemCode: true, itemName: true, occurrence: true, netAmount: true, paidAt: true, customerId: true } } },
      }),
    ]);
    const page = rows.slice(0, take);
    const cIds = [...new Set(page.map((r) => r.customerId))];
    const cs = cIds.length ? await ctx.tenantDb.agentCustomer.findMany({ where: { id: { in: cIds } }, select: { id: true, name: true } }) : [];
    const cName = new Map(cs.map((c) => [c.id, c.name]));
    return {
      balances: walletSummary(all, payouts),
      entries: page.map((r) => ({ ...r, customerName: cName.get(r.customerId) ?? null })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  // ── انتقال مشتری ────────────────────────────────────────
  /** مشتری به نماینده‌ی دیگرِ همان محصول منتقل می‌شود؛ پورسانت تراکنش‌های بعدی به او می‌رسد. سوابق گذشته جابه‌جا نمی‌شود. */
  async transferCustomer(ctx: TenantRequestContext, customerId: string, dto: TransferCustomerDto) {
    const by = await resolveTenantUserId(ctx).catch(() => null);
    return ctx.tenantDb.$transaction(async (tx) => {
      const c = await tx.agentCustomer.findUnique({ where: { id: customerId } });
      if (!c) throw new NotFoundException('مشتری یافت نشد');
      if (c.membershipId === dto.toMembershipId) throw new BadRequestException('مشتری همین حالا متعلق به این نماینده است');
      const target = await tx.agentProductMembership.findUnique({ where: { id: dto.toMembershipId } });
      if (!target || target.productId !== c.productId) throw new BadRequestException('نماینده‌ی مقصد باید در همین محصول عضو باشد');
      if (target.status !== 'ACTIVE') throw new BadRequestException('نماینده‌ی مقصد فعال نیست');
      const moved = await tx.agentCustomer.updateMany({ where: { id: c.id, membershipId: c.membershipId }, data: { membershipId: target.id } });
      if (moved.count !== 1) throw new ConflictException('مشتری هم‌زمان تغییر کرد؛ دوباره تلاش کنید');
      await tx.agentCustomerTransfer.create({ data: { customerId: c.id, fromMembershipId: c.membershipId, toMembershipId: target.id, reason: dto.reason?.trim() || null, byUserId: by } });
      await tx.agentAuditLog.create({ data: { membershipId: target.id, action: 'customer.transferred', detail: `${c.id} از ${c.membershipId}${dto.reason ? ` — ${dto.reason.trim()}` : ''}`, actorUserId: by } });
      return { customerId: c.id, fromMembershipId: c.membershipId, toMembershipId: target.id };
    });
  }

  transfers(ctx: TenantRequestContext, customerId: string) {
    return ctx.tenantDb.agentCustomerTransfer.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  }
}
