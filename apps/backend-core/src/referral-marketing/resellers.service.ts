import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
export class ResellersService {
  constructor(
    private readonly users: UsersService,
    private readonly commissionService: ReferralCommissionService,
  ) {}

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
