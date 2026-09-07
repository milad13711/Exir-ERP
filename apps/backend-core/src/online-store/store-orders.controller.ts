import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { StoreOrdersService } from './store-orders.service.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';

@Controller('online-store/orders')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('online-store')
export class StoreOrdersController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'online-store');
    return this.orders.list(ctx, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'online-store');
    return this.orders.detail(ctx, id);
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'online-store');
    return this.orders.updateStatus(ctx, id, dto);
  }
}
