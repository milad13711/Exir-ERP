import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PlatformOwnerGuard, isPlatformOwnerContext } from '../common/guards/platform-owner.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { CreateModuleInvoiceDto } from '../admin/dto/create-module-invoice.dto.js';
import { PlatformManagementService } from './platform-management.service.js';
import { PlatformReplyDto, PlatformTicketStatusDto } from './platform-management.dto.js';

/**
 * Platform management for the PARENT tenant (env PLATFORM_TENANT_SLUG, default
 * 'eta'). Every route except /platform/me is gated by PlatformOwnerGuard — any
 * other tenant gets 403.
 */
@Controller('platform')
@UseGuards(JwtAuthGuard)
export class PlatformManagementController {
  constructor(private readonly platform: PlatformManagementService) {}

  /** برای هر کاربر واردشده؛ فقط تعیین می‌کند آیتم منو نمایش داده شود. */
  @Get('me')
  me(@Ctx() ctx: TenantRequestContext) {
    return { isPlatformOwner: isPlatformOwnerContext(ctx) };
  }

  @Get('modules')
  @UseGuards(PlatformOwnerGuard)
  modules() {
    return this.platform.listCatalog();
  }

  @Get('tenants')
  @UseGuards(PlatformOwnerGuard)
  tenants() {
    return this.platform.listTenants();
  }

  @Get('tenants/:id')
  @UseGuards(PlatformOwnerGuard)
  tenant(@Param('id') id: string) {
    return this.platform.getTenantDetail(id);
  }

  @Post('tenants/:id/module-invoice')
  @UseGuards(PlatformOwnerGuard)
  createModuleInvoice(@Param('id') id: string, @Body() dto: CreateModuleInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    return this.platform.createModuleInvoice(ctx, id, dto);
  }

  @Get('invoices')
  @UseGuards(PlatformOwnerGuard)
  invoices(@Query('status') status?: string, @Query('tenantId') tenantId?: string, @Query('recurring') recurring?: string) {
    return this.platform.listInvoices({ status, tenantId, recurring: recurring === 'true' });
  }

  @Get('renewals')
  @UseGuards(PlatformOwnerGuard)
  renewals() {
    return this.platform.listRenewals();
  }

  @Get('invoices/:id')
  @UseGuards(PlatformOwnerGuard)
  invoice(@Param('id') id: string) {
    return this.platform.getInvoice(id);
  }

  @Post('invoices/:id/mark-paid')
  @UseGuards(PlatformOwnerGuard)
  markPaid(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.platform.markInvoicePaid(ctx, id);
  }

  @Post('invoices/:id/cancel')
  @UseGuards(PlatformOwnerGuard)
  cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.platform.cancelInvoice(ctx, id);
  }

  @Get('tickets')
  @UseGuards(PlatformOwnerGuard)
  tickets(@Query('status') status?: string, @Query('tenantId') tenantId?: string) {
    return this.platform.listTickets({ status, tenantId });
  }

  @Get('tickets/:id')
  @UseGuards(PlatformOwnerGuard)
  ticket(@Param('id') id: string) {
    return this.platform.getTicket(id);
  }

  @Post('tickets/:id/messages')
  @UseGuards(PlatformOwnerGuard)
  reply(@Param('id') id: string, @Body() dto: PlatformReplyDto, @Ctx() ctx: TenantRequestContext) {
    return this.platform.replyToTicket(ctx, id, dto.body);
  }

  @Post('tickets/:id/status')
  @UseGuards(PlatformOwnerGuard)
  setStatus(@Param('id') id: string, @Body() dto: PlatformTicketStatusDto, @Ctx() ctx: TenantRequestContext) {
    return this.platform.setTicketStatus(ctx, id, dto.status, dto.resolutionNote);
  }
}
