import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { RecordPurchasePaymentDto } from './dto/record-purchase-payment.dto.js';
import { RejectPurchaseOrderDto } from './dto/reject-purchase-order.dto.js';
import { UpdateApprovalThresholdDto } from './dto/update-approval-threshold.dto.js';

@Controller('purchasing/orders')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('purchasing')
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('q') q: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'purchasing', 'createdByUserId');
    return this.orders.list(ctx, scope, q);
  }

  @Get('settings/approval-threshold')
  async getApprovalThreshold(@Ctx() ctx: TenantRequestContext) {
    return { threshold: await this.orders.getApprovalThreshold(ctx) };
  }

  @Put('settings/approval-threshold')
  async setApprovalThreshold(@Body() dto: UpdateApprovalThresholdDto, @Ctx() ctx: TenantRequestContext) {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر می‌تواند این تنظیم را تغییر دهد');
    }
    await this.orders.setApprovalThreshold(ctx, dto.threshold ?? null);
    return { threshold: await this.orders.getApprovalThreshold(ctx) };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'purchasing', 'createdByUserId');
    return this.orders.detail(ctx, id, scope);
  }

  @Post()
  async create(@Body() dto: CreatePurchaseOrderDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'purchasing');
    return this.orders.create(ctx, dto);
  }

  @Put(':id')
  async updateDraft(@Param('id') id: string, @Body() dto: CreatePurchaseOrderDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'purchasing');
    return this.orders.updateDraft(ctx, id, dto);
  }

  @Delete(':id')
  async removeDraft(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'purchasing');
    return this.orders.removeDraft(ctx, id);
  }

  @Post(':id/cancel')
  async cancelDraft(@Param('id') id: string, @Body() dto: { reason?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'purchasing');
    return this.orders.cancelDraft(ctx, id, (dto?.reason ?? 'بدون توضیح').trim());
  }

  @Post(':id/receive')
  async receive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'purchasing');
    return this.orders.receive(ctx, id);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.orders.approve(ctx, id);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectPurchaseOrderDto, @Ctx() ctx: TenantRequestContext) {
    return this.orders.reject(ctx, id, dto.reason);
  }

  @Post(':id/payments')
  async recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPurchasePaymentDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'purchasing');
    return this.orders.recordPayment(ctx, id, dto);
  }
}
