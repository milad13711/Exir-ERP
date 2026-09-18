import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ResellersService } from './resellers.service.js';
import { CreateResellerDto } from './dto/create-reseller.dto.js';
import { UpdateResellerDto } from './dto/update-reseller.dto.js';

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

  @Get(':id/tenants')
  async tenants(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.tenants(ctx, id);
  }

  @Get(':id/commissions')
  async commissions(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'referral-marketing');
    return this.resellers.commissions(ctx, id);
  }
}
