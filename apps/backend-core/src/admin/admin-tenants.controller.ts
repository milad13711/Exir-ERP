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
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { CreateModuleInvoiceDto } from './dto/create-module-invoice.dto.js';
import { modulePriceForMode } from '../modules-catalog/module-pricing.js';
import { getManagerUsers } from '../common/manager-users.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
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

  /** اعلان درون‌برنامه + پوش برای مدیران تننت؛ لینک به صفحه‌ی اشتراک و صورتحساب. شکست اعلان هرگز صدور فاکتور را خراب نمی‌کند. */
  private async notifyInvoiceIssued(tenant: { id: string; dbHost: string; dbPort: number; dbName: string }, body: string) {
    try {
      const tenantDb = this.tenantPrisma.forTenant(tenant);
      const managers = await getManagerUsers(this.controlDb, tenantDb, tenant.id);
      for (const m of managers) {
        await this.notifications
          .notify(tenantDb, { userId: m.tenantUserId, type: 'billing.invoice_issued', title: 'فاکتور جدید برای شما صادر شد', body, link: '/settings/billing' })
          .catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }

  @Post(':id/invoices')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async createInvoice(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @AdminCtx() ctx: AdminRequestContext) {
    const invoice = await this.tenants.createInvoice(
      id,
      { amount: dto.amount, dueAt: new Date(dto.dueAt), subscriptionId: dto.subscriptionId, lines: dto.lines },
      ctx.auth.sub,
    );
    const tenant = await this.controlDb.tenant.findUnique({ where: { id } });
    if (tenant) await this.notifyInvoiceIssued(tenant, `${dto.lines?.map((l) => l.name).join('، ') || 'فاکتور دستی'} — ${dto.amount.toLocaleString('en-US')} تومان`);
    return invoice;
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

  /**
   * فاکتور دستی بر اساس ماژول‌های موردنیاز و نوع پرداخت (اشتراک ماهانه/سالانه یا لایسنس مادام‌العمر).
   * دقیقاً همان فاکتور MODULE_PURCHASE سبد خرید تننت است: بعد از پرداخت، ماژول‌ها خودکار فعال/تمدید می‌شوند.
   * در صفحه‌ی اشتراک/صورتحساب تننت دیده می‌شود و برای مدیران تننت اعلان (درون‌برنامه + پوش) می‌رود.
   */
  @Post(':id/module-invoice')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async createModuleInvoice(@Param('id') id: string, @Body() dto: CreateModuleInvoiceDto, @AdminCtx() ctx: AdminRequestContext) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');
    const catalog = await this.controlDb.moduleDefinition.findMany({ where: { code: { in: dto.items.map((i) => i.code) } } });
    const byCode = new Map(catalog.map((m) => [m.code, m]));
    const lineItems = dto.items.map((item) => {
      const m = byCode.get(item.code);
      if (!m) throw new NotFoundException(`ماژول «${item.code}» یافت نشد`);
      return { moduleCode: m.code, moduleName: m.name, billingMode: item.billingMode, amount: modulePriceForMode(m, item.billingMode) };
    });
    const amount = lineItems.reduce((sum, l) => sum + l.amount, 0);
    const invoice = await this.controlDb.invoice.create({
      data: { tenantId: id, amount, purpose: 'MODULE_PURCHASE', items: lineItems, status: 'PENDING', dueAt: dto.dueAt ? new Date(dto.dueAt) : new Date(Date.now() + 7 * 86_400_000) },
    });
    await this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: ctx.auth.sub, tenantId: id, action: 'invoice.module_issued', entityType: 'Invoice', entityId: invoice.id, metadata: { items: lineItems, amount } as never },
    });

    const modeLabel = (m: string) => (m === 'LICENSE' ? 'لایسنس مادام‌العمر' : m === 'YEARLY' ? 'اشتراک سالانه' : 'اشتراک ماهانه');
    await this.notifyInvoiceIssued(
      tenant,
      `${lineItems.map((l) => `${l.moduleName} (${modeLabel(l.billingMode)})`).join('، ')} — ${amount.toLocaleString('en-US')} تومان${dto.note ? ` — ${dto.note}` : ''}`,
    );
    return invoice;
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
