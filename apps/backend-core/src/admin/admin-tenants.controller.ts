import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { InvoicePdfService } from '../billing/invoice-pdf.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { SuspendTenantDto } from './dto/suspend-tenant.dto.js';
import { RenewTenantDto } from './dto/renew-tenant.dto.js';
import { DeleteTenantDto } from './dto/delete-tenant.dto.js';
import { SetTenantModuleDto } from './dto/set-tenant-module.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';

/**
 * The management team's control surface over the tenant directory: onboard,
 * suspend/reactivate, renew, permanently delete, monitor, and control each
 * tenant's module access. Every action here writes an AuditLog row (see
 * TenantsService) so it stays traceable.
 */
@Controller('admin/tenants')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminTenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly controlDb: ControlPrismaService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  @Get()
  @AdminTeams('SUPER_ADMIN', 'SUPPORT', 'BILLING')
  list() {
    return this.tenants.listTenants();
  }

  @Post()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  create(@Body() dto: CreateTenantDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.createTenant(dto, { type: 'admin_user', id: ctx.auth.sub });
  }

  @Get(':id')
  @AdminTeams('SUPER_ADMIN', 'SUPPORT', 'BILLING')
  async get(@Param('id') id: string) {
    const tenants = await this.tenants.listTenants();
    const tenant = tenants.find((t) => t.id === id);
    if (!tenant) throw new NotFoundException('تننت یافت نشد');
    return tenant;
  }

  @Get(':id/stats')
  @AdminTeams('SUPER_ADMIN', 'SUPPORT', 'BILLING', 'ENGINEERING')
  stats(@Param('id') id: string) {
    return this.tenants.getTenantStats(id);
  }

  @Get(':id/modules')
  @AdminTeams('SUPER_ADMIN', 'SUPPORT', 'BILLING')
  modules(@Param('id') id: string) {
    return this.tenants.listTenantModules(id);
  }

  @Post(':id/modules/:code')
  @AdminTeams('SUPER_ADMIN', 'SUPPORT')
  setModule(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() dto: SetTenantModuleDto,
    @AdminCtx() ctx: AdminRequestContext,
  ) {
    return this.tenants.setTenantModule(id, code, dto.status, ctx.auth.sub);
  }

  @Post(':id/suspend')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  suspend(
    @Param('id') id: string,
    @Body() dto: SuspendTenantDto,
    @AdminCtx() ctx: AdminRequestContext,
  ) {
    return this.tenants.suspendTenant(id, dto.reason, ctx.auth.sub);
  }

  @Post(':id/reactivate')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  reactivate(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.reactivateTenant(id, ctx.auth.sub);
  }

  @Put(':id/subscription')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  updateSubscription(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.updateSubscription(id, { currentPeriodEnd: dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : undefined, status: dto.status, lifetime: dto.lifetime, planCode: dto.planCode }, ctx.auth.sub);
  }

  @Post(':id/renew')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  renew(@Param('id') id: string, @Body() dto: RenewTenantDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.renewTenant(id, dto.months, ctx.auth.sub);
  }

  @Get(':id/invoices')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  invoices(@Param('id') id: string) {
    return this.tenants.listInvoices(id);
  }

  @Post(':id/invoices')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  createInvoice(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.createInvoice(
      id,
      { amount: dto.amount, dueAt: new Date(dto.dueAt), subscriptionId: dto.subscriptionId, lines: dto.lines },
      ctx.auth.sub,
    );
  }

  @Get(':id/invoices/:invoiceId/pdf')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async downloadInvoicePdf(@Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const { invoice, tenant, plan } = await this.tenants.getInvoiceWithContext(invoiceId);
    const pdf = await this.invoicePdf.renderInvoicePdf(invoice, tenant, plan);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoiceId.slice(0, 8)}.pdf"`);
    res.send(pdf);
  }

  @Put(':id/invoices/:invoiceId')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  updateInvoice(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @Body() dto: UpdateInvoiceDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.updateInvoice(id, invoiceId, { amount: dto.amount, dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined, status: dto.status, lines: dto.lines }, ctx.auth.sub);
  }

  @Delete(':id/invoices/:invoiceId')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  deleteInvoice(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.deleteInvoice(id, invoiceId, ctx.auth.sub);
  }

  @Post(':id/invoices/:invoiceId/mark-unpaid')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  markInvoiceUnpaid(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.markInvoiceUnpaid(id, invoiceId, ctx.auth.sub);
  }

  @Post(':id/invoices/:invoiceId/mark-paid')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  markInvoicePaid(@Param('invoiceId') invoiceId: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.tenants.markInvoicePaid(invoiceId, ctx.auth.sub);
  }

  @Delete(':id')
  @AdminTeams('SUPER_ADMIN')
  async remove(@Param('id') id: string, @Body() dto: DeleteTenantDto, @AdminCtx() ctx: AdminRequestContext) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id } });
    if (!tenant || dto.confirmSlug !== tenant.slug) {
      throw new BadRequestException('شناسه‌ی تننت برای تأیید حذف مطابقت ندارد');
    }
    await this.tenants.deleteTenant(id, ctx.auth.sub);
    return { success: true };
  }
}
