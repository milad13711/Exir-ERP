import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { UsersService } from '../users/users.service.js';
import { ReferralCommissionService } from './referral-commission.service.js';
import type { CreateResellerDto } from './dto/create-reseller.dto.js';
import type { UpdateResellerDto } from './dto/update-reseller.dto.js';

const RESELLER_ROLE_NAME = 'نماینده';

const RESELLER_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true, address: true } },
  user: { select: { id: true, phone: true, status: true } },
};

/**
 * نمایندگان همان مخاطبین CRM هستند (isSupplier: true) — این سرویس فقط
 * فیلدهای مخصوص نمایندگی (ResellerProfile) را کنارش مدیریت می‌کند، طبق
 * تصمیم معماری این ماژول: بدون ساخت هیچ مدل/استک موازی جدید.
 */
@Injectable()
export class ResellersService implements OnModuleInit {
  constructor(
    private readonly users: UsersService,
    private readonly commissionService: ReferralCommissionService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // درخواست پایان همکاری از سوی نماینده → کارتابل مدیر؛ تأیید = پایان همکاری + صورتحساب مانده
    this.approvals.registerHandler('RESELLER_END', {
      approve: async (ctx, id, opts) => {
        await this.endCooperation(ctx, id, opts.requestSummary ?? 'درخواست نماینده');
      },
      reject: async (ctx, id) => {
        await ctx.tenantDb.resellerProfile.update({ where: { id }, data: { cooperationStatus: 'ACTIVE', endRequestedAt: null } });
      },
      describe: async (ctx, id) => {
        const r = await ctx.tenantDb.resellerProfile.findUniqueOrThrow({ where: { id }, include: { contact: true } });
        const b = await this.balance(ctx, id);
        return {
          fields: [
            { label: 'نماینده', value: `${r.contact.company || r.contact.name} — ${r.contact.phone ?? ''}` },
            { label: 'کل کمیسیون', value: `${b.totalCommission.toLocaleString('en-US')} تومان` },
            { label: 'پرداخت‌شده', value: `${b.paidCommission.toLocaleString('en-US')} تومان` },
            { label: 'مانده‌ی تسویه', value: `${b.amountDue.toLocaleString('en-US')} تومان` },
          ],
        };
      },
    });
  }

  /** مانده‌ی کمیسیون نماینده: هر کمیسیون یک سفارش خرید (بدهی) است؛ مانده = مبلغ کمیسیون − پرداخت‌شده‌ی همان سفارش. */
  async balance(ctx: TenantRequestContext, id: string) {
    const commissions = await ctx.tenantDb.referralCommission.findMany({
      where: { referralConversion: { resellerProfileId: id } },
      include: { referralConversion: { select: { contact: { select: { name: true, company: true } } } }, purchaseOrder: { select: { orderNo: true, paidAmount: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const lines = commissions.map((c) => {
      const paid = Math.min(c.purchaseOrder.paidAmount, c.amount);
      return {
        customer: c.referralConversion.contact.company || c.referralConversion.contact.name,
        kind: c.kind,
        orderNo: c.purchaseOrder.orderNo,
        amount: c.amount,
        paid,
        due: c.amount - paid,
      };
    });
    const totalCommission = lines.reduce((a, l) => a + l.amount, 0);
    const paidCommission = lines.reduce((a, l) => a + l.paid, 0);
    return { lines, totalCommission, paidCommission, amountDue: totalCommission - paidCommission };
  }

  async generateSettlement(ctx: TenantRequestContext, id: string, note?: string) {
    await this.detail(ctx, id);
    const b = await this.balance(ctx, id);
    return ctx.tenantDb.resellerSettlement.create({
      data: { resellerProfileId: id, totalCommission: b.totalCommission, paidCommission: b.paidCommission, amountDue: b.amountDue, lines: b.lines, note },
    });
  }

  listSettlements(ctx: TenantRequestContext, id: string) {
    return ctx.tenantDb.resellerSettlement.findMany({ where: { resellerProfileId: id }, orderBy: { issuedAt: 'desc' } });
  }

  async settle(ctx: TenantRequestContext, settlementId: string) {
    const s = await ctx.tenantDb.resellerSettlement.findUnique({ where: { id: settlementId } });
    if (!s) throw new NotFoundException('صورتحساب یافت نشد');
    if (s.status === 'SETTLED') throw new ConflictException('این صورتحساب قبلاً تسویه شده است');
    return ctx.tenantDb.resellerSettlement.update({ where: { id: settlementId }, data: { status: 'SETTLED', settledAt: new Date() } });
  }

  /** پایان همکاری: نمایش روی نقشه متوقف می‌شود و صورتحساب مانده‌ی تسویه صادر می‌شود. */
  async endCooperation(ctx: TenantRequestContext, id: string, reason: string) {
    const r = await this.detail(ctx, id);
    if (r.cooperationStatus === 'ENDED') throw new ConflictException('همکاری این نماینده قبلاً پایان یافته است');
    await ctx.tenantDb.resellerProfile.update({
      where: { id },
      data: { cooperationStatus: 'ENDED', endedAt: new Date(), endReason: reason, hiddenFromMap: true, endRequestedAt: null },
    });
    await this.approvals.closeForEntity(ctx, 'RESELLER_END', id, 'APPROVED');
    return this.generateSettlement(ctx, id, `پایان همکاری: ${reason}`);
  }

  async setMapVisibility(ctx: TenantRequestContext, id: string, hidden: boolean) {
    await this.detail(ctx, id);
    return ctx.tenantDb.resellerProfile.update({ where: { id }, data: { hiddenFromMap: hidden }, include: RESELLER_INCLUDE });
  }

  /** نماینده خودش پایان همکاری را درخواست می‌دهد؛ تا تأیید مدیر همکاری ادامه دارد. */
  async requestEnd(ctx: TenantRequestContext, id: string, reason: string) {
    const r = await this.detail(ctx, id);
    if (r.cooperationStatus !== 'ACTIVE') throw new ConflictException('درخواست پایان همکاری قبلاً ثبت شده یا همکاری پایان یافته است');
    if (reason.trim().length < 3) throw new BadRequestException('دلیل را بنویسید');
    await ctx.tenantDb.resellerProfile.update({ where: { id }, data: { cooperationStatus: 'END_REQUESTED', endRequestedAt: new Date() } });
    const name = r.contact.company || r.contact.name;
    await this.approvals.request(ctx, {
      moduleCode: 'referral-marketing',
      entityType: 'RESELLER_END',
      entityId: id,
      title: `پایان همکاری نماینده ${name}`,
      summary: reason.trim(),
      link: '/referral-marketing',
    });
    return { success: true };
  }

  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.resellerProfile.findMany({
      include: RESELLER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const reseller = await ctx.tenantDb.resellerProfile.findUnique({ where: { id }, include: RESELLER_INCLUDE });
    if (!reseller) throw new NotFoundException('نماینده یافت نشد');
    return reseller;
  }

  async create(ctx: TenantRequestContext, dto: CreateResellerDto) {
    const contact = await ctx.tenantDb.crmContact.create({
      data: {
        name: dto.name,
        company: dto.company,
        phone: dto.phone,
        address: dto.address,
        type: dto.company ? 'COMPANY' : 'INDIVIDUAL',
        isCustomer: false,
        isSupplier: true,
      },
    });

    return ctx.tenantDb.resellerProfile.create({
      data: {
        contactId: contact.id,
        websiteUrl: dto.websiteUrl,
        logoUrl: dto.logoUrl,
        shabaNumber: dto.shabaNumber,
        tier: dto.tier ?? 'B',
      },
      include: RESELLER_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateResellerDto) {
    const reseller = await ctx.tenantDb.resellerProfile.findUnique({ where: { id } });
    if (!reseller) throw new NotFoundException('نماینده یافت نشد');

    if (dto.name || dto.company !== undefined || dto.phone !== undefined || dto.address !== undefined) {
      await ctx.tenantDb.crmContact.update({
        where: { id: reseller.contactId },
        data: { name: dto.name, company: dto.company, phone: dto.phone, address: dto.address },
      });
    }

    return ctx.tenantDb.resellerProfile.update({
      where: { id },
      data: {
        websiteUrl: dto.websiteUrl,
        logoUrl: dto.logoUrl,
        shabaNumber: dto.shabaNumber,
        tier: dto.tier,
        isVerified: dto.isVerified,
        verifiedAt: dto.isVerified ? new Date() : dto.isVerified === false ? null : undefined,
        commissionFirstPaymentPercent: dto.commissionFirstPaymentPercent,
        commissionRenewalPercent: dto.commissionRenewalPercent,
      },
      include: RESELLER_INCLUDE,
    });
  }

  /** اعطای دسترسی ورود به نماینده — از همان جریان دعوت کاربر (Users.inviteUser) استفاده می‌کند، بدون استک احراز هویت جدید. */
  async grantAccess(ctx: TenantRequestContext, id: string) {
    const reseller = await ctx.tenantDb.resellerProfile.findUnique({
      where: { id },
      include: { contact: true },
    });
    if (!reseller) throw new NotFoundException('نماینده یافت نشد');
    if (reseller.userId) throw new ConflictException('این نماینده قبلاً دسترسی ورود دارد');
    if (!reseller.contact.phone) throw new ConflictException('برای اعطای دسترسی، ابتدا شماره تماس نماینده را ثبت کنید');

    const roleId = await this.getOrCreateResellerRoleId(ctx);
    const user = await this.users.inviteUser(ctx, reseller.contact.name, reseller.contact.phone, roleId);

    return ctx.tenantDb.resellerProfile.update({
      where: { id },
      data: { userId: user.id },
      include: RESELLER_INCLUDE,
    });
  }

  async conversions(ctx: TenantRequestContext, id: string) {
    await this.detail(ctx, id);
    return ctx.tenantDb.referralConversion.findMany({
      where: { resellerProfileId: id },
      include: { contact: { select: { id: true, name: true, company: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** یک مشتری CRM موجود را به این نماینده وصل می‌کند — کاربردی برای استفاده‌ی عمومی هر تننت (نه فقط تننت رجیستری پلتفرم). */
  async linkConversion(ctx: TenantRequestContext, id: string, contactId: string) {
    await this.detail(ctx, id);
    return this.commissionService.linkContact(ctx, id, contactId);
  }

  async commissions(ctx: TenantRequestContext, id: string) {
    await this.detail(ctx, id);
    return ctx.tenantDb.referralCommission.findMany({
      where: { referralConversion: { resellerProfileId: id } },
      include: {
        referralConversion: { select: { contact: { select: { name: true, company: true } }, controlTenantId: true } },
        purchaseOrder: { select: { orderNo: true, status: true, total: true, paidAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** مقایسه‌ی عملکرد همه‌ی نمایندگان — تعداد مشتری معرفی‌شده و جمع کمیسیون تعهدی/پرداخت‌شده هر کدام. */
  async dashboard(ctx: TenantRequestContext) {
    const resellers = await ctx.tenantDb.resellerProfile.findMany({
      include: {
        contact: { select: { name: true, company: true } },
        conversions: {
          include: {
            commissions: { include: { purchaseOrder: { select: { total: true, paidAmount: true } } } },
          },
        },
      },
    });

    return resellers
      .map((r) => {
        const commissions = r.conversions.flatMap((c) => c.commissions);
        const totalCommission = commissions.reduce((sum, c) => sum + c.amount, 0);
        const paidCommission = commissions.reduce(
          (sum, c) => sum + Math.min(c.purchaseOrder.paidAmount, c.amount),
          0,
        );
        return {
          id: r.id,
          name: r.contact.name,
          company: r.contact.company,
          tier: r.tier,
          isVerified: r.isVerified,
          npsAvgScore: r.npsAvgScore,
          referredCustomerCount: r.conversions.length,
          totalCommission,
          paidCommission,
          pendingCommission: totalCommission - paidCommission,
        };
      })
      .sort((a, b) => b.totalCommission - a.totalCommission);
  }

  private async getOrCreateResellerRoleId(ctx: TenantRequestContext): Promise<string> {
    const existing = await ctx.tenantDb.role.findUnique({ where: { name: RESELLER_ROLE_NAME } });
    if (existing) return existing.id;
    const created = await this.users.createRole(ctx, RESELLER_ROLE_NAME);
    return created.id;
  }
}
