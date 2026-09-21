import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { AfterSalesService, AFTER_SALES_MODULE_CODE } from './after-sales.service.js';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto.js';
import { UpdateAfterSalesGeneralSettingsDto } from './dto/update-general-settings.dto.js';
import { UpdateAfterSalesSmsSettingsDto } from './dto/update-sms-settings.dto.js';

@Controller('after-sales-service')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule(AFTER_SALES_MODULE_CODE)
export class AfterSalesController {
  constructor(
    private readonly afterSales: AfterSalesService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('services')
  async listServices(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.listServices(ctx, status);
  }

  @Get('services/:id')
  async serviceDetail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.serviceDetail(ctx, id);
  }

  @Patch('services/:id/status')
  async updateServiceStatus(@Param('id') id: string, @Body() dto: UpdateServiceStatusDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.updateServiceStatus(ctx, id, dto);
  }

  @Post('services/:id/sms')
  async sendSms(@Param('id') id: string, @Body() body: { message: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.sendCustomSmsToServiceCustomer(ctx, id, body.message ?? '');
  }

  @Get('service-status-labels')
  serviceStatusLabels() {
    return this.afterSales.serviceStatusLabels();
  }

  @Get('reports')
  async reports(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.getReportsData(ctx);
  }

  @Get('settings/general')
  async getGeneralSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.getGeneralSettings(ctx);
  }

  @Put('settings/general')
  async setGeneralSettings(@Body() dto: UpdateAfterSalesGeneralSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.setGeneralSettings(ctx, dto);
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.getSmsSettings(ctx);
  }

  @Put('settings/sms')
  async setSmsSettings(@Body() dto: UpdateAfterSalesSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, AFTER_SALES_MODULE_CODE);
    return this.afterSales.setSmsSettings(ctx, dto);
  }
}
