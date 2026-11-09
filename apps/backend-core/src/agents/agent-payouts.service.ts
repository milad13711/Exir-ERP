import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import QRCode from 'qrcode';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { AGENTS_MODULE_CODE, AGENT_LEVEL_LABELS, type AgentLevel } from './agent-constants.js';
import { canTransitionPayout, OPEN_PAYOUT_STATUSES, payoutRejection, referralUrl, walletSummary, type PayoutStatus } from './agent-commission.js';
import { normalizeIranMobile } from './agent-phone.js';
import { maskSheba } from './sheba.js';

type Db = TenantRequestContext['tenantDb'];
type Tx = Prisma.TransactionClient;

const MAX_TAKE = 200;
const DAY = 86_400_000;

export type PayoutFilter = { status?: string; productId?: string; membershipId?: string; take?: number; cursor?: string };

/**
 * تسویه‌ی کیف پول نماینده: درخواست (نماینده یا ادمین) → تأیید → پرداخت دستی توسط مالی با شماره‌ی پیگیری.
 * - مبلغ درخواست‌های در جریان از موجودی قابل تسویه رزرو می‌شود؛ رد/لغو آزادش می‌کند.
 * - هم‌زمانی: قفل advisory به‌ازای عضویت + ایندکس یکتای جزئی «یک درخواست باز برای هر عضویت».
 * - شبا در لحظه‌ی درخواست snapshot می‌شود و فقط شبای تأییدشده با OTP پذیرفته است.
 * - گذارها شرطی (updateMany با وضعیت مبدأ) تا دو کلیک هم‌زمان دو بار پرداخت ثبت نکند.
 * Also: کارت ویزیت نماینده (لینک معرفی + QR).
 */
@Injectable()
export class AgentPayoutsService {
  private readonly logger = new Logger(AgentPayoutsService.name);
  constructor(private readonly sms: TenantSmsService) {}

  async summaryFor(db: Db | Tx, membershipId: string, now = new Date()) {
    const [commissions, payouts] = await Promise.all([
      db.agentCommission.findMany({ where: { membershipId }, select: { amount: true, availableAt: true } }),
      db.agentPayout.findMany({ where: { membershipId }, select: { amount: true, status: true } }),
    ]);
    return walletSummary(commissions, payouts, now);
  }

  /** ثبت درخواست تسویه. by=AGENT از پنل خودِ نماینده (عضویت از قبل در دامنه‌ی او بررسی شده)، by=ADMIN از طرف مالی. */
  async request(ctx: TenantRequestContext, membershipId: string, amount: number, note: string | undefined, by: 'AGENT' | 'ADMIN') {
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    try {
      return await ctx.tenantDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'agent-payout:' + membershipId}))`;
        const m = await tx.agentProductMembership.findUnique({
          where: { id: membershipId },
          include: { product: { select: { minSettlementAmount: true, name: true } }, resellerProfile: { select: { id: true, shabaNumber: true, shebaVerifiedAt: true } } },
        });
        if (!m) throw new NotFoundException('عضویت یافت نشد');
        const summary = await this.summaryFor(tx, membershipId);
        const open = await tx.agentPayout.count({ where: { membershipId, status: { in: [...OPEN_PAYOUT_STATUSES] } } });
        const sheba = m.resellerProfile.shabaNumber;
        const rej = payoutRejection({
          amount,
          withdrawable: summary.withdrawable,
          minAmount: m.product.minSettlementAmount,
          membershipStatus: m.status,
          hasOpenPayout: open > 0,
          shebaVerified: !!sheba && !!m.resellerProfile.shebaVerifiedAt,
        });
        if (rej) throw new UnprocessableEntityException({ code: rej.code, message: rej.message });
        const p = await tx.agentPayout.create({
          data: {
            productId: m.productId,
            membershipId,
            resellerProfileId: m.resellerProfile.id,
            amount,
            shebaNumber: sheba!,
            requestedByType: by,
            requestedByUserId: userId,
            agentNote: note?.trim() || null,
          },
        });
        await tx.agentAuditLog.create({
          data: { resellerProfileId: m.resellerProfile.id, membershipId, action: 'payout.requested', detail: `#${p.number} ${amount}`, actorUserId: userId, actorType: by },
        });
        return p;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('یک درخواست تسویه‌ی در جریان وجود دارد');
      throw e;
    }
  }

  /** نماینده فقط درخواست «ثبت‌شده»ی خودش را لغو می‌کند (پس از تأیید مالی، فقط ادمین می‌تواند رد کند). */
  async cancelOwn(ctx: TenantRequestContext, profileId: string, payoutId: string) {
    const p = await ctx.tenantDb.agentPayout.findFirst({ where: { id: payoutId, resellerProfileId: profileId } });
    if (!p) throw new NotFoundException('درخواست یافت نشد');
    return this.transition(ctx, p.id, 'CANCELLED', {}, 'AGENT');
  }

  approve(ctx: TenantRequestContext, payoutId: string) {
    return this.transition(ctx, payoutId, 'APPROVED', {}, 'ADMIN');
  }

  async reject(ctx: TenantRequestContext, payoutId: string, reason: string) {
    const r = reason?.trim();
    if (!r) throw new BadRequestException('دلیل رد الزامی است');
    return this.transition(ctx, payoutId, 'REJECTED', { rejectReason: r.slice(0, 500) }, 'ADMIN');
  }

  /** ثبت پرداخت دستی (واریز بانکی انجام‌شده خارج از سیستم) با شماره‌ی پیگیری. */
  async markPaid(ctx: TenantRequestContext, payoutId: string, dto: { trackingNumber: string; paidAt?: string; note?: string }) {
    const tracking = dto.trackingNumber?.trim();
    if (!tracking || !/^[A-Za-z0-9\-_/.]{4,64}$/.test(tracking)) throw new BadRequestException('شماره‌ی پیگیری نامعتبر است (۴ تا ۶۴ نویسه‌ی لاتین/عدد)');
    const now = new Date();
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : now;
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('تاریخ پرداخت نامعتبر است');
    if (paidAt.getTime() > now.getTime() + DAY) throw new BadRequestException('تاریخ پرداخت نمی‌تواند در آینده باشد');
    return this.transition(ctx, payoutId, 'PAID', { trackingNumber: tracking, paidAt, paymentNote: dto.note?.trim().slice(0, 500) || null }, 'ADMIN');
  }

  private async transition(ctx: TenantRequestContext, payoutId: string, to: PayoutStatus, extra: Prisma.AgentPayoutUpdateManyMutationInput, actor: 'AGENT' | 'ADMIN') {
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const now = new Date();
    const updated = await ctx.tenantDb.$transaction(async (tx) => {
      const p = await tx.agentPayout.findUnique({ where: { id: payoutId } });
      if (!p) throw new NotFoundException('درخواست یافت نشد');
      if (!canTransitionPayout(p.status, to)) throw new ConflictException(`این درخواست در وضعیت ${p.status} است و قابل تغییر به ${to} نیست`);
      // تأیید/واریز فقط اگر شبای درخواست هنوز همان شبای تأییدشده‌ی فعلی نماینده است
      if (to === 'APPROVED' || to === 'PAID') {
        const prof = await tx.resellerProfile.findUnique({ where: { id: p.resellerProfileId }, select: { shabaNumber: true, shebaVerifiedAt: true } });
        if (!prof?.shebaVerifiedAt || prof.shabaNumber !== p.shebaNumber) {
          throw new ConflictException({ code: 'SHEBA_CHANGED', message: 'شبای این درخواست با شبای تأییدشده‌ی فعلی نماینده یکی نیست؛ درخواست را رد کنید تا نماینده دوباره درخواست دهد' });
        }
      }
      const who: Prisma.AgentPayoutUpdateManyMutationInput =
        to === 'PAID' ? { paidByUserId: userId } : to === 'CANCELLED' ? {} : { reviewedByUserId: userId, reviewedAt: now };
      const res = await tx.agentPayout.updateMany({ where: { id: p.id, status: p.status }, data: { status: to, ...who, ...extra } });
      if (res.count !== 1) throw new ConflictException('درخواست هم‌زمان تغییر کرد؛ صفحه را تازه کنید');
      await tx.agentAuditLog.create({
        data: { resellerProfileId: p.resellerProfileId, membershipId: p.membershipId, action: `payout.${to.toLowerCase()}`, detail: `#${p.number} ${p.amount}${to === 'PAID' ? ` پیگیری ${String(extra.trackingNumber)}` : ''}`, actorUserId: userId, actorType: actor },
      });
      return tx.agentPayout.findUniqueOrThrow({ where: { id: p.id } });
    });
    if (to === 'PAID' || to === 'REJECTED') await this.notify(ctx, updated);
    return updated;
  }

  /** پیامک نتیجه به نماینده — پس از commit؛ خطای پیامک هرگز نتیجه‌ی مالی را برنمی‌گرداند. */
  private async notify(ctx: TenantRequestContext, p: { resellerProfileId: string; productId: string; number: number; amount: number; status: string; trackingNumber: string | null; rejectReason: string | null }) {
    try {
      const prof = await ctx.tenantDb.resellerProfile.findUnique({ where: { id: p.resellerProfileId }, select: { contact: { select: { phone: true } } } });
      const product = await ctx.tenantDb.agentProduct.findUnique({ where: { id: p.productId }, select: { name: true } });
      const phone = normalizeIranMobile(prof?.contact.phone);
      if (!phone) return;
      const amount = p.amount.toLocaleString('fa-IR');
      const msg =
        p.status === 'PAID'
          ? `تسویه‌ی شماره ${p.number} (${product?.name ?? ''}) به مبلغ ${amount} واریز شد. شماره پیگیری: ${p.trackingNumber}`
          : `درخواست تسویه‌ی شماره ${p.number} (${product?.name ?? ''}) رد شد. دلیل: ${p.rejectReason ?? '-'}`;
      await this.sms.sendSms({ tenantId: ctx.tenantId, tenantDb: ctx.tenantDb }, phone, msg, { purpose: 'agent-payout', moduleCode: AGENTS_MODULE_CODE, actorType: 'SYSTEM' as never });
    } catch (e) {
      this.logger.warn(`payout sms failed: ${(e as Error).message}`);
    }
  }

  /** فهرست درخواست‌ها. revealSheba فقط برای ادمین (مالی برای واریز به شبای کامل نیاز دارد). */
  async list(ctx: TenantRequestContext, f: PayoutFilter, revealSheba: boolean) {
    const take = Math.min(Math.max(f.take ?? 50, 1), MAX_TAKE);
    const where: Prisma.AgentPayoutWhereInput = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.productId ? { productId: f.productId } : {}),
      ...(f.membershipId ? { membershipId: f.membershipId } : {}),
    };
    const [rows, totals] = await Promise.all([
      ctx.tenantDb.agentPayout.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) }),
      ctx.tenantDb.agentPayout.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: true }),
    ]);
    const page = rows.slice(0, take);
    const pIds = [...new Set(page.map((r) => r.resellerProfileId))];
    const prodIds = [...new Set(page.map((r) => r.productId))];
    const [profiles, products] = await Promise.all([
      pIds.length ? ctx.tenantDb.resellerProfile.findMany({ where: { id: { in: pIds } }, select: { id: true, contact: { select: { name: true, phone: true } } } }) : [],
      prodIds.length ? ctx.tenantDb.agentProduct.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true } }) : [],
    ]);
    const pMap = new Map(profiles.map((p) => [p.id, p.contact]));
    const prodMap = new Map(products.map((p) => [p.id, p.name]));
    return {
      items: page.map((r) => ({
        ...r,
        shebaNumber: revealSheba ? r.shebaNumber : maskSheba(r.shebaNumber),
        agentName: pMap.get(r.resellerProfileId)?.name ?? null,
        agentPhone: revealSheba ? (pMap.get(r.resellerProfileId)?.phone ?? null) : undefined,
        productName: prodMap.get(r.productId) ?? null,
      })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
      totals: totals.map((t) => ({ status: t.status, count: t._count, amount: t._sum.amount ?? 0 })),
    };
  }

  // ── گزارش ────────────────────────────────────────────────
  /**
   * گزارش عملکرد نماینده‌ها در یک بازه: مشتری جدید، فروش خالص (اول/تمدید/برگشت)، پورسانت ایجادشده، تسویه‌ی پرداخت‌شده
   * + وضعیت فعلی کیف پول (مستقل از بازه). به‌علاوه‌ی جمع فروشِ بدون نماینده‌ی محصول برای مقایسه.
   */
  async report(ctx: TenantRequestContext, q: { productId?: string; from?: string; to?: string }) {
    const db = ctx.tenantDb;
    const now = new Date();
    const from = q.from ? new Date(q.from) : new Date(now.getTime() - 30 * DAY);
    const to = q.to ? new Date(q.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestException('بازه‌ی تاریخ نامعتبر است');
    const prod = q.productId ? { productId: q.productId } : {};
    const range = { gte: from, lte: to };

    const [memberships, newCustomers, txs, commissions, paidOut, availNow, heldNow, payoutsNow, unattributed] = await Promise.all([
      db.agentProductMembership.findMany({
        where: { ...prod, status: { not: 'PENDING' } },
        select: { id: true, level: true, status: true, product: { select: { id: true, name: true } }, resellerProfile: { select: { contact: { select: { name: true } } } } },
      }),
      db.agentCustomer.groupBy({ by: ['membershipId'], where: { ...prod, registeredAt: range }, _count: true }),
      db.agentTransaction.groupBy({ by: ['membershipId', 'occurrence'], where: { ...prod, membershipId: { not: null }, paidAt: range }, _sum: { netAmount: true }, _count: true }),
      db.agentCommission.groupBy({ by: ['membershipId'], where: { ...prod, createdAt: range }, _sum: { amount: true } }),
      db.agentPayout.groupBy({ by: ['membershipId'], where: { ...prod, status: 'PAID', paidAt: range }, _sum: { amount: true } }),
      db.agentCommission.groupBy({ by: ['membershipId'], where: { ...prod, OR: [{ amount: { lt: 0 } }, { availableAt: { lte: now } }] }, _sum: { amount: true } }),
      db.agentCommission.groupBy({ by: ['membershipId'], where: { ...prod, amount: { gte: 0 }, availableAt: { gt: now } }, _sum: { amount: true } }),
      db.agentPayout.groupBy({ by: ['membershipId', 'status'], where: { ...prod, status: { in: [...OPEN_PAYOUT_STATUSES, 'PAID'] } }, _sum: { amount: true } }),
      db.agentTransaction.groupBy({ by: ['occurrence'], where: { ...prod, membershipId: null, paidAt: range }, _sum: { netAmount: true }, _count: true }),
    ]);
    const sumBy = <T extends { membershipId: string | null; _sum: { amount?: number | null } }>(rows: T[]) => new Map(rows.map((r) => [r.membershipId, r._sum.amount ?? 0]));
    const nc = new Map(newCustomers.map((r) => [r.membershipId, r._count]));
    const com = sumBy(commissions);
    const paid = sumBy(paidOut);
    const avail = sumBy(availNow);
    const held = sumBy(heldNow);
    const rows = memberships.map((m) => {
      const t = txs.filter((x) => x.membershipId === m.id);
      const net = (occ: string) => t.filter((x) => x.occurrence === occ).reduce((a, x) => a + (x._sum.netAmount ?? 0), 0);
      const refunds = net('REFUND');
      const sales = net('FIRST') + net('RENEWAL') + net('ONE_OFF');
      const pend = payoutsNow.filter((x) => x.membershipId === m.id && x.status !== 'PAID').reduce((a, x) => a + (x._sum.amount ?? 0), 0);
      const paidAll = payoutsNow.filter((x) => x.membershipId === m.id && x.status === 'PAID').reduce((a, x) => a + (x._sum.amount ?? 0), 0);
      return {
        membershipId: m.id,
        agentName: m.resellerProfile.contact.name,
        productId: m.product.id,
        productName: m.product.name,
        level: m.level,
        status: m.status,
        newCustomers: nc.get(m.id) ?? 0,
        txCount: t.filter((x) => x.occurrence !== 'REFUND').reduce((a, x) => a + x._count, 0),
        firstSales: net('FIRST'),
        renewalSales: net('RENEWAL') + net('ONE_OFF'),
        refunds,
        netSales: sales - refunds,
        commission: com.get(m.id) ?? 0,
        paidInPeriod: paid.get(m.id) ?? 0,
        withdrawable: (avail.get(m.id) ?? 0) - pend - paidAll,
        held: held.get(m.id) ?? 0,
        pending: pend,
      };
    });
    rows.sort((a, b) => b.netSales - a.netSales);
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (r[k] as number), 0);
    const un = (occ: string) => unattributed.filter((x) => x.occurrence === occ).reduce((a, x) => a + (x._sum.netAmount ?? 0), 0);
    return {
      from,
      to,
      rows,
      totals: {
        newCustomers: sum('newCustomers'),
        netSales: sum('netSales'),
        commission: sum('commission'),
        paidInPeriod: sum('paidInPeriod'),
        withdrawable: sum('withdrawable'),
        held: sum('held'),
        pending: sum('pending'),
        unattributedNetSales: un('FIRST') + un('RENEWAL') + un('ONE_OFF') - un('REFUND'),
      },
    };
  }

  // ── کارت ویزیت ─────────────────────────────────────────
  async businessCard(ctx: TenantRequestContext, membershipId: string) {
    const m = await ctx.tenantDb.agentProductMembership.findUnique({
      where: { id: membershipId },
      include: {
        product: { select: { name: true, logoUrl: true, websiteUrl: true, referralUrlTemplate: true } },
        resellerProfile: { select: { logoUrl: true, city: true, isVerified: true, contact: { select: { name: true, company: true, phone: true } } } },
      },
    });
    if (!m) throw new NotFoundException('عضویت یافت نشد');
    const url = m.status === 'ACTIVE' ? referralUrl(m.product.referralUrlTemplate, m.product.websiteUrl, m.referralCode) : null;
    const qrSvg = url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
    return {
      active: m.status === 'ACTIVE',
      agentName: m.resellerProfile.contact.name,
      company: m.resellerProfile.contact.company,
      phone: m.resellerProfile.contact.phone,
      city: m.resellerProfile.city,
      agentLogoUrl: m.resellerProfile.logoUrl,
      verified: m.resellerProfile.isVerified,
      level: m.level,
      levelLabel: AGENT_LEVEL_LABELS[m.level as AgentLevel] ?? m.level,
      productName: m.product.name,
      productLogoUrl: m.product.logoUrl,
      referralCode: m.referralCode,
      referralUrl: url,
      qrSvg,
    };
  }
}
