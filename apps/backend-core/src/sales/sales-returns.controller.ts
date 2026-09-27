import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { SalesReturnsService } from './sales-returns.service.js';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto.js';

@Controller('sales/returns')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('sales')
export class SalesReturnsController {
  constructor(
    private readonly returns: SalesReturnsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'sales');
    return this.returns.list(ctx);
  }

  /** برای نمایش/عدم‌نمایش دکمه‌ی «ثبت مرجوعی» در کلاینت — قبل از ':id' تعریف شده تا با آن تداخل نکند. */
  @Get('invoice/:invoiceId/returnable')
  async returnable(@Param('invoiceId') invoiceId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'sales');
    return this.returns.returnable(ctx, invoiceId);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'sales');
    return this.returns.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateSalesReturnDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'sales');
    return this.returns.create(ctx, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'sales');
    return this.returns.remove(ctx, id);
  }
}
