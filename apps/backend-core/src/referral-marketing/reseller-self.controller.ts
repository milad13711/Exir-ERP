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

  @Get('conversions')
  async conversions(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return ctx.tenantDb.referralConversion.findMany({
      where: { resellerProfileId: reseller.id },
      include: { contact: { select: { id: true, name: true, company: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('commissions')
  async commissions(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return ctx.tenantDb.referralCommission.findMany({
      where: { referralConversion: { resellerProfileId: reseller.id } },
      include: {
        referralConversion: { select: { contact: { select: { name: true, company: true } }, controlTenantId: true } },
        purchaseOrder: { select: { orderNo: true, status: true, total: true, paidAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * فقط برای مشتری‌هایی که معادل یک تننت پلتفرم exirerp هستند (controlTenantId
   * پر است) معنا دارد؛ برای مشتریان معمولی یک تننت عادی خالی برمی‌گردد.
   * فقط خواندنی در این فاز — پاسخ‌دادن/بستن تیکت نیاز به گسترش SenderType دارد.
   */
  @Get('support-tickets')
  async supportTickets(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    const conversions = await ctx.tenantDb.referralConversion.findMany({
      where: { resellerProfileId: reseller.id, controlTenantId: { not: null } },
      select: { controlTenantId: true, contact: { select: { name: true, company: true } } },
    });
    if (conversions.length === 0) return [];
    const nameByTenantId = new Map(conversions.map((c) => [c.controlTenantId, c.contact.company ?? c.contact.name]));

    const tickets = await this.controlDb.supportTicket.findMany({
      where: { tenantId: { in: conversions.map((c) => c.controlTenantId!) } },
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
