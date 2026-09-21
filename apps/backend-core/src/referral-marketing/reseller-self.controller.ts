import { BadRequestException, Body, Controller, Get, NotFoundException, Patch, Post, UseGuards } from '@nestjs/common';
import { UpdateMyResellerProfileDto } from './dto/update-my-reseller-profile.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ResellersService } from './resellers.service.js';
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
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly resellers: ResellersService,
  ) {}

  @Get()
  async profile(@Ctx() ctx: TenantRequestContext) {
    return this.myResellerProfile(ctx);
  }

  /** نماینده عکس و اطلاعات نمایشی‌اش را برای پین نقشه‌ی همکاران eta.co.ir خودش ویرایش می‌کند. */
  @Patch()
  async updateProfile(@Body() dto: UpdateMyResellerProfileDto, @Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    if (dto.logoUrl && !/^data:image\/(png|jpe?g|webp);base64,/.test(dto.logoUrl)) {
      throw new BadRequestException('فقط تصویر PNG، JPG یا WEBP مجاز است');
    }
    await ctx.tenantDb.resellerProfile.update({
      where: { id: reseller.id },
      data: { logoUrl: dto.logoUrl, bio: dto.bio, websiteUrl: dto.websiteUrl, city: dto.city },
    });
    if (dto.company !== undefined || dto.address !== undefined) {
      await ctx.tenantDb.crmContact.update({ where: { id: reseller.contactId }, data: { company: dto.company, address: dto.address } });
    }
    return this.myResellerProfile(ctx);
  }

  /** نماینده پایان همکاری را درخواست می‌دهد — بعد از تأیید مدیر، صورتحساب مانده جهت تسویه صادر می‌شود. */
  @Post('end-request')
  async requestEnd(@Body() dto: { reason: string }, @Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return this.resellers.requestEnd(ctx, reseller.id, dto?.reason ?? '');
  }

  @Get('settlements')
  async mySettlements(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return this.resellers.listSettlements(ctx, reseller.id);
  }

  @Get('balance')
  async myBalance(@Ctx() ctx: TenantRequestContext) {
    const reseller = await this.myResellerProfile(ctx);
    return this.resellers.balance(ctx, reseller.id);
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
