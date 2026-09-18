import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

const RESELLER_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true, address: true } },
};

/**
 * دید خودِ نماینده — با همان ورود معمولی کاربر تننت (شماره+OTP)، بدون هیچ
 * استک احراز هویت جدا. اگر کاربر جاری ResellerProfile نداشته باشد یعنی
 * نماینده نیست؛ فرانت این را با ۴۰۴ تشخیص می‌دهد و تبِ «پنل من» را نشان نمی‌دهد.
 */
@Controller('referral-marketing/me')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('referral-marketing')
export class ResellerSelfController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  async profile(@Ctx() ctx: TenantRequestContext) {
    return this.myResellerProfile(ctx);
  }

  @Get('tenants')
  async tenants(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return ctx.tenantDb.referredTenant.findMany({
      where: { resellerProfileId: reseller.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('commissions')
  async commissions(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return ctx.tenantDb.referralCommission.findMany({
      where: { referredTenant: { resellerProfileId: reseller.id } },
      include: {
        referredTenant: { select: { tenantName: true, tenantSlug: true } },
        purchaseOrder: { select: { orderNo: true, status: true, total: true, paidAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * فقط خواندنی در این فاز — پاسخ‌دادن/بستن تیکت نیاز به گسترش SenderType
   * دارد؛ کار بعدی است، نه مسدودکننده‌ی این فاز.
   */
  @Get('support-tickets')
  async supportTickets(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    const referredTenants = await ctx.tenantDb.referredTenant.findMany({
      where: { resellerProfileId: reseller.id },
      select: { controlTenantId: true, tenantName: true },
    });
    if (referredTenants.length === 0) return [];
    const nameByTenantId = new Map(referredTenants.map((t) => [t.controlTenantId, t.tenantName]));

    const tickets = await this.controlDb.supportTicket.findMany({
      where: { tenantId: { in: referredTenants.map((t) => t.controlTenantId) } },
      orderBy: { createdAt: 'desc' },
    });
    return tickets.map((t) => ({ ...t, tenantName: nameByTenantId.get(t.tenantId) }));
  }

  private async myResellerProfile(ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    const reseller = userId
      ? await ctx.tenantDb.resellerProfile.findUnique({ where: { userId }, include: RESELLER_INCLUDE })
      : null;
    if (!reseller) throw new NotFoundException('شما نماینده‌ی ثبت‌شده‌ای نیستید');
    return reseller;
  }
}
