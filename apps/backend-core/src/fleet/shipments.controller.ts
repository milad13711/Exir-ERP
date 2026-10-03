import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ShipmentsService } from './shipments.service.js';
import { CreateShipmentDto } from './dto/create-shipment.dto.js';
import { SendOffersDto } from './dto/send-offers.dto.js';
import { UpdateFleetSmsSettingsDto } from './dto/update-fleet-sms-settings.dto.js';

@Controller('fleet/shipments')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('fleet')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('q') q: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'fleet');
    return this.shipments.list(ctx, { status, contactId, q });
  }

  @Post()
  async create(@Body() dto: CreateShipmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'fleet');
    return this.shipments.create(ctx, dto);
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'fleet');
    return this.shipments.getSmsSettings(ctx);
  }

  @Patch('settings/sms')
  async setSmsSettings(@Body() dto: UpdateFleetSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'fleet');
    return this.shipments.setSmsSettings(ctx, dto);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'fleet');
    return this.shipments.detail(ctx, id);
  }

  @Get(':id/match-candidates')
  async matchCandidates(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'fleet');
    return this.shipments.matchCandidates(ctx, id);
  }

  @Post(':id/send-offers')
  async sendOffers(@Param('id') id: string, @Body() dto: SendOffersDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'fleet');
    return this.shipments.sendOffers(ctx, id, dto.driverIds);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'fleet');
    return this.shipments.cancel(ctx, id);
  }

  @Post(':id/deliver')
  async deliver(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'fleet');
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return this.shipments.deliver(ctx, id, publicWebUrl, ctx.tenantSlug);
  }
}
