import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto.js';

/** کدهای تخفیف روی هزینه‌ی آنالیز نمونه — کد با percentOff=100 آنالیز را کاملاً رایگان می‌کند. */
@Controller('ration-lab/discount-codes')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationDiscountCodesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'ration-lab');
    return ctx.tenantDb.rationDiscountCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@Body() dto: CreateDiscountCodeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');
    return ctx.tenantDb.rationDiscountCode.create({
      data: {
        code: dto.code,
        percentOff: dto.percentOff,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        maxRedemptions: dto.maxRedemptions,
      },
    });
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    const code = await ctx.tenantDb.rationDiscountCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('کد تخفیف یافت نشد');
    return ctx.tenantDb.rationDiscountCode.update({ where: { id }, data: { isActive: false } });
  }
}
