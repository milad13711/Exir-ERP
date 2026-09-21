import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { safeDelete } from '../common/safe-delete.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ResellersService } from './resellers.service.js';
import { CreateResellerDto } from './dto/create-reseller.dto.js';
import { UpdateResellerDto } from './dto/update-reseller.dto.js';
import { LinkConversionDto } from './dto/link-conversion.dto.js';

/** دسترسی مدیریتی به فهرست نمایندگان — دیدِ محدود خودِ نماینده در ResellerSelfController است. */
@Controller('referral-marketing/resellers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('referral-marketing')
export class ResellersController {
  constructor(
    private readonly resellers: ResellersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.list(ctx);
  }

  @Get('dashboard')
  async dashboard(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.dashboard(ctx);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateResellerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'referral-marketing');
    return this.resellers.create(ctx, dto);
  }

  /** فقط پروفایل نمایندگی حذف می‌شود؛ مخاطب CRM و سوابق مالی سر جایشان می‌مانند. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'referral-marketing');
    await safeDelete(() => ctx.tenantDb.resellerProfile.delete({ where: { id } }));
    return { success: true };
  }

  @Get(':id/balance')
  async balance(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.balance(ctx, id);
  }

  @Get(':id/settlements')
  async settlements(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.listSettlements(ctx, id);
  }

  @Post(':id/settlements')
  async createSettlement(@Param('id') id: string, @Body() dto: { note?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.generateSettlement(ctx, id, dto?.note);
  }

  @Post('settlements/:settlementId/settle')
  async settle(@Param('settlementId') settlementId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.settle(ctx, settlementId);
  }

  @Post(':id/end')
  async end(@Param('id') id: string, @Body() dto: { reason?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.endCooperation(ctx, id, (dto?.reason ?? 'پایان همکاری').trim());
  }

  @Post(':id/map-visibility')
  async mapVisibility(@Param('id') id: string, @Body() dto: { hidden: boolean }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.setMapVisibility(ctx, id, !!dto.hidden);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateResellerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.update(ctx, id, dto);
  }

  @Post(':id/grant-access')
  async grantAccess(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.grantAccess(ctx, id);
  }

  @Get(':id/conversions')
  async conversions(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.conversions(ctx, id);
  }

  /** اتصال یک مشتری CRM موجود به این نماینده — از این پس فاکتورهای تسویه‌شده‌ی آن مشتری خودکار کمیسیون می‌سازند. */
  @Post(':id/conversions')
  async linkConversion(@Param('id') id: string, @Body() dto: LinkConversionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'referral-marketing');
    return this.resellers.linkConversion(ctx, id, dto.contactId);
  }

  @Get(':id/commissions')
  async commissions(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.commissions(ctx, id);
  }
}
