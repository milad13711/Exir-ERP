import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { assertInScope } from '../permissions/scope.util.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto.js';

@Controller('purchasing/returns')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('purchasing')
export class PurchaseReturnsController {
  constructor(
    private readonly returns: PurchaseReturnsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'purchasing');
    return this.returns.list(ctx);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'purchasing');
    return this.returns.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreatePurchaseReturnDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'purchasing');
    const scope = await this.permissions.viewScope(ctx, 'purchasing', 'createdByUserId');
    await assertInScope(ctx.tenantDb.purchaseOrder, scope, { id: dto.orderId }, { message: 'سفارش خرید یافت نشد' });
    return this.returns.create(ctx, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'purchasing');
    await this.permissions.assertViewAll(ctx, 'purchasing');
    return this.returns.remove(ctx, id);
  }
}
