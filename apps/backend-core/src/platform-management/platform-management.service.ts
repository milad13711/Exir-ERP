import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { SupportGateway } from '../support/support.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { moduleLicensePrice, modulePriceForMode, moduleYearlyPrice } from '../modules-catalog/module-pricing.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateModuleInvoiceDto } from '../admin/dto/create-module-invoice.dto.js';
import type { InvoiceStatus, TicketStatus } from '../../generated/control-client/index.js';

export const PARENT_SOURCE = 'parent-tenant';

/**
 * Platform management from the PARENT tenant: a thin layer over the very same
 * control-plane records the admin panel reads/writes (single source of truth),
 * so everything done here is automatically visible in the admin panel. Every
 * mutation additionally writes an AuditLog tagged source='parent-tenant'.
 */
@Injectable()
export class PlatformManagementService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenants: TenantsService,
    private readonly gateway: SupportGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // ── audit ────────────────────────────────────────────────────────────
  private async actorName(ctx: TenantRequestContext): Promise<string | null> {
    const u = await this.controlDb.globalUser.findUnique({ where: { id: ctx.auth.sub }, select: { name: true, phone: true } });
    return u?.name ?? u?.phone ?? null;
  }

  private async audit(
    ctx: TenantRequestContext,
    tenantId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ) {
    const actorName = await this.actorName(ctx);
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user',
        actorId: ctx.auth.sub,
        tenantId,
        action,
        entityType,
        entityId,
        metadata: { ...metadata, source: PARENT_SOURCE, parentTenantSlug: ctx.tenantSlug, actorName } as never,
      },
    });
  }

  // ── catalog ──────────────────────────────────────────────────────────
  async listCatalog() {
    const modules = await this.controlDb.moduleDefinition.findMany({ orderBy: { createdAt: 'asc' } });
    return modules.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      category: m.category,
      isCore: m.isCore,
      isListed: m.isListed,
      version: m.version,
      licenseUsd: m.licenseUsd,
      priceMonthly: m.priceMonthly,
      priceYearly: moduleYearlyPrice(m),
      priceLicense: moduleLicensePrice(m),
    }));
  }

  // ── tenants ──────────────────────────────────────────────────────────
  async listTenants() {
    const [tenants, installed] = await Promise.all([
      this.tenants.listTenants(),
      this.controlDb.tenantModule.groupBy({ by: ['tenantId'], where: { status: { in: ['INSTALLED', 'TRIAL'] } }, _count: { _all: true } }),
    ]);
    const counts = new Map(installed.map((r) => [r.tenantId, r._count._all]));
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.createdAt,
      planName: t.subscriptions[0]?.plan?.name ?? null,
      subscriptionStatus: t.subscriptions[0]?.status ?? null,
      currentPeriodEnd: t.subscriptions[0]?.currentPeriodEnd ?? null,
      activeModulesCount: counts.get(t.id) ?? 0,
    }));
  }

  async getTenantDetail(id: string) {
    const tenant = (await this.listTenants()).find((t) => t.id === id);
    if (!tenant) throw new NotFoundException('تننت یافت نشد');
    const [modules, invoices] = await Promise.all([
      this.controlDb.tenantModule.findMany({
        where: { tenantId: id },
        include: { module: { select: { code: true, name: true, category: true } } },
        orderBy: { installedAt: 'asc' },
      }),
      this.tenants.listInvoices(id),
    ]);
    return {
      tenant,
      modules: modules.map((m) => ({
        code: m.module.code,
        name: m.module.name,
        category: m.module.category,
        status: m.status,
        billingMode: m.billingMode,
        currentPeriodEnd: m.currentPeriodEnd,
        pendingRenewalInvoiceId: m.pendingRenewalInvoiceId,
      })),
      invoices,
    };
  }

  // ── invoices ─────────────────────────────────────────────────────────
  async listInvoices(filter: { status?: string; tenantId?: string; recurring?: boolean }) {
    const status = ['PENDING', 'PAID', 'FAILED'].includes(filter.status ?? '') ? (filter.status as InvoiceStatus) : undefined;
    return this.controlDb.invoice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
        ...(filter.recurring ? { purpose: 'MODULE_RENEWAL' } : {}),
      },
      orderBy: { issuedAt: 'desc' },
      take: 300,
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
  }

  async getInvoice(id: string) {
    const invoice = await this.controlDb.invoice.findUnique({ where: { id }, include: { tenant: { select: { id: true, name: true, slug: true } } } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    return invoice;
  }

  /** ماژول‌های اشتراکی (ماهانه/سالانه) به‌همراه تاریخ تمدید بعدی و فاکتور تمدیدِ خودکار باز — خروجی cron ModuleRenewalService. */
  async listRenewals() {
    const rows = await this.controlDb.tenantModule.findMany({
      where: { billingMode: { in: ['MONTHLY', 'YEARLY'] }, status: { not: 'DISABLED' }, currentPeriodEnd: { not: null } },
      orderBy: { currentPeriodEnd: 'asc' },
      include: { module: true, tenant: { select: { id: true, name: true, slug: true } } },
    });
    const pendingIds = rows.map((r) => r.pendingRenewalInvoiceId).filter((x): x is string => !!x);
    const pending = pendingIds.length ? await this.controlDb.invoice.findMany({ where: { id: { in: pendingIds } } }) : [];
    const byId = new Map(pending.map((i) => [i.id, i]));
    return rows.map((r) => ({
      tenant: r.tenant,
      moduleCode: r.module.code,
      moduleName: r.module.name,
      billingMode: r.billingMode,
      nextRenewalAt: r.currentPeriodEnd,
      renewalAmount: r.billingMode ? modulePriceForMode(r.module, r.billingMode) : 0,
      pendingInvoice: r.pendingRenewalInvoiceId ? (byId.get(r.pendingRenewalInvoiceId) ?? null) : null,
    }));
  }

  /** همان فاکتور MODULE_PURCHASE پنل ادمین (قیمت از module-pricing.ts)؛ بعد از پرداخت، ماژول‌ها خودکار فعال می‌شوند. */
  async createModuleInvoice(ctx: TenantRequestContext, tenantId: string, dto: CreateModuleInvoiceDto) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId } });
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
      data: { tenantId, amount, purpose: 'MODULE_PURCHASE', items: lineItems, status: 'PENDING', dueAt: dto.dueAt ? new Date(dto.dueAt) : new Date(Date.now() + 7 * 86_400_000) },
    });
    await this.audit(ctx, tenantId, 'invoice.module_issued', 'Invoice', invoice.id, { items: lineItems, amount });

    const modeLabel = (m: string) => (m === 'LICENSE' ? 'لایسنس مادام‌العمر' : m === 'YEARLY' ? 'اشتراک سالانه' : 'اشتراک ماهانه');
    await this.notifyInvoiceIssued(tenant, `${lineItems.map((l) => `${l.moduleName} (${modeLabel(l.billingMode)})`).join('، ')} — ${amount.toLocaleString('en-US')} تومان${dto.note ? ` — ${dto.note}` : ''}`);
    return invoice;
  }

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
      // اعلان هرگز صدور فاکتور را خراب نمی‌کند
    }
  }

  /** دقیقاً همان settlement پنل ادمین (فعال‌سازی ماژول‌ها، رفرال، شارژ پیامک…)؛ فقط برچسب ممیزی «تننت مادر» است. */
  async markInvoicePaid(ctx: TenantRequestContext, invoiceId: string) {
    const invoice = await this.controlDb.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    const name = await this.actorName(ctx);
    return this.tenants.markInvoicePaid(invoiceId, ctx.auth.sub, {
      actorType: 'global_user',
      metadata: { source: PARENT_SOURCE, parentTenantSlug: ctx.tenantSlug, actorName: name },
    });
  }

  /** لغو = وضعیت FAILED (همان کاری که ویرایش فاکتور در پنل ادمین می‌کند)؛ فاکتور پرداخت‌شده قابل لغو نیست. */
  async cancelInvoice(ctx: TenantRequestContext, invoiceId: string) {
    const invoice = await this.controlDb.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    if (invoice.status === 'PAID') throw new BadRequestException('فاکتور پرداخت‌شده قابل لغو نیست');
    const updated = await this.controlDb.invoice.update({ where: { id: invoiceId }, data: { status: 'FAILED', paidAt: null, paymentRefId: null } });
    // اگر فاکتور تمدید خودکار بود، قفل pendingRenewalInvoiceId آزاد شود تا cron بتواند دوباره بسازد
    await this.controlDb.tenantModule.updateMany({ where: { pendingRenewalInvoiceId: invoiceId }, data: { pendingRenewalInvoiceId: null } });
    await this.audit(ctx, invoice.tenantId, 'invoice.updated', 'Invoice', invoiceId, { before: { amount: invoice.amount, status: invoice.status }, after: { status: 'FAILED' }, cancelled: true });
    return updated;
  }

  // ── support tickets ──────────────────────────────────────────────────
  listTickets(filter: { status?: string; tenantId?: string }) {
    const status = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(filter.status ?? '') ? (filter.status as TicketStatus) : undefined;
    return this.controlDb.supportTicket.findMany({
      where: { ...(status ? { status } : {}), ...(filter.tenantId ? { tenantId: filter.tenantId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        tenant: { select: { name: true, slug: true } },
        createdByUser: { select: { name: true, phone: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async getTicket(id: string) {
    const ticket = await this.controlDb.supportTicket.findUnique({
      where: { id },
      include: {
        tenant: { select: { name: true, slug: true } },
        createdByUser: { select: { name: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    return ticket;
  }

  /** مثل پاسخ ادمین: SupportMessage با senderType ADMIN — تننت صاحب تیکت دقیقاً همان را می‌بیند. */
  async replyToTicket(ctx: TenantRequestContext, ticketId: string, body: string) {
    const ticket = await this.controlDb.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    const message = await this.controlDb.supportMessage.create({ data: { ticketId, senderType: 'ADMIN', senderId: ctx.auth.sub, body } });
    this.gateway.notifyNewMessage(ticket, message);
    await this.audit(ctx, ticket.tenantId, 'support_ticket.replied', 'SupportTicket', ticketId, { messageId: message.id });
    return message;
  }

  async setTicketStatus(ctx: TenantRequestContext, ticketId: string, status: TicketStatus, resolutionNote?: string) {
    const existing = await this.controlDb.supportTicket.findUnique({ where: { id: ticketId } });
    if (!existing) throw new NotFoundException('تیکت یافت نشد');
    const done = status === 'RESOLVED' || status === 'CLOSED';
    const ticket = await this.controlDb.supportTicket.update({
      where: { id: ticketId },
      data: { status, resolvedAt: done ? (existing.resolvedAt ?? new Date()) : null, ...(resolutionNote ? { resolutionNote } : {}) },
    });
    await this.controlDb.supportMessage.create({
      data: { ticketId, senderType: 'SYSTEM', body: status === 'RESOLVED' ? `تیکت رفع شد${resolutionNote ? `: ${resolutionNote}` : ''}` : `وضعیت تیکت تغییر کرد: ${status}` },
    });
    await this.audit(ctx, ticket.tenantId, status === 'RESOLVED' ? 'support_ticket.resolved' : 'support_ticket.status_changed', 'SupportTicket', ticketId, { from: existing.status, to: status, resolutionNote });
    this.gateway.notifyTicketUpdated(ticket);
    return ticket;
  }
}
