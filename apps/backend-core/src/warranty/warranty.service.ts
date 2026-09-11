import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { generateWarrantyCode } from './warranty-code.util.js';
import type { ManualIssueDto } from './dto/manual-issue.dto.js';
import type { UpdateServiceStatusDto } from './dto/update-service-status.dto.js';
import type { UpdateProductWarrantySettingsDto } from './dto/update-product-settings.dto.js';
import type { UpdateWarrantyGeneralSettingsDto } from './dto/update-general-settings.dto.js';
import type { UpdateWarrantySmsSettingsDto } from './dto/update-sms-settings.dto.js';
import type { ImportLegacyWarrantyRowDto } from './dto/import-legacy.dto.js';

const MODULE_CODE = 'warranty';
const GENERAL_KEY = { moduleCode: MODULE_CODE, key: 'general' } as const;
const SMS_KEY = { moduleCode: MODULE_CODE, key: 'sms' } as const;

type GeneralSettings = {
  defaultDurationDays: number;
  reminderDaysBeforeExpiry: number;
  termsConditions: string;
  serviceTermsConditions: string;
};

const DEFAULT_GENERAL: GeneralSettings = {
  defaultDurationDays: 365,
  reminderDaysBeforeExpiry: 15,
  termsConditions: '',
  serviceTermsConditions: '',
};

type SmsSettings = {
  enabled: boolean;
  activationCustomerEnabled: boolean;
  activationCustomerTemplate: string;
  activationStaffEnabled: boolean;
  activationStaffTemplate: string;
  serviceNewStaffEnabled: boolean;
  serviceNewStaffTemplate: string;
  serviceStatusCustomerEnabled: boolean;
  serviceStatusCustomerTemplate: string;
  serviceStatusStaffEnabled: boolean;
  serviceStatusStaffTemplate: string;
  quickTemplates: { title: string; text: string }[];
};

const DEFAULT_SMS: SmsSettings = {
  enabled: false,
  activationCustomerEnabled: true,
  activationCustomerTemplate: 'مشتری گرامی {name}، گارانتی محصول شما با کد {code} با موفقیت فعال شد.',
  activationStaffEnabled: true,
  activationStaffTemplate: 'گارانتی با کد {code} توسط مشتری {name} فعال شد.',
  serviceNewStaffEnabled: true,
  serviceNewStaffTemplate: 'درخواست خدمات پس از فروش جدید برای کد گارانتی {code} ثبت شد.',
  serviceStatusCustomerEnabled: true,
  serviceStatusCustomerTemplate: 'مشتری گرامی {name}، وضعیت درخواست خدمات پس از فروش شما (کد {code}) به «{status}» تغییر کرد.',
  serviceStatusStaffEnabled: false,
  serviceStatusStaffTemplate: 'وضعیت درخواست خدمات کد {code} به «{status}» تغییر کرد.',
  quickTemplates: [
    { title: 'کالا دریافت شد', text: 'مشتری گرامی {name}، کالای شما (کد گارانتی {code}) دریافت شد و بررسی آغاز شد.' },
    { title: 'در حال تعمیر', text: 'مشتری گرامی {name}، کالای شما (کد {code}) در حال تعمیر/بررسی است.' },
    { title: 'برطرف شد، آماده تحویل', text: 'مشتری گرامی {name}، مشکل کالای شما (کد {code}) برطرف شد و آماده ارسال/تحویل است.' },
    { title: 'یادآوری ارسال کالا', text: 'مشتری گرامی {name}، لطفاً کالای مرتبط با کد گارانتی {code} را برای بررسی خدمات پس از فروش ارسال کنید.' },
  ],
};

const SERVICE_STATUS_LABELS: Record<string, string> = {
  NEW: 'جدید',
  REVIEWING: 'در حال بررسی',
  AWAITING_PRODUCT: 'در انتظار ارسال کالا',
  IN_PROGRESS: 'در حال تعمیر',
  RESOLVED: 'برطرف‌شده',
  CLOSED: 'بسته‌شده',
};

const CODE_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  contact: { select: { id: true, name: true, phone: true } },
  invoice: { select: { id: true, invoiceNo: true } },
} as const;

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, val);
  }
  return out;
}

@Injectable()
export class WarrantyService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────────────────────── تنظیمات ───────────────────────── */

  async getGeneralSettings(ctx: TenantRequestContext): Promise<GeneralSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: GENERAL_KEY } });
    return row ? { ...DEFAULT_GENERAL, ...(row.value as Partial<GeneralSettings>) } : DEFAULT_GENERAL;
  }

  async setGeneralSettings(ctx: TenantRequestContext, dto: UpdateWarrantyGeneralSettingsDto): Promise<GeneralSettings> {
    const value = { ...dto };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: GENERAL_KEY },
      update: { value },
      create: { ...GENERAL_KEY, value },
    });
    return this.getGeneralSettings(ctx);
  }

  async getSmsSettings(ctx: TenantRequestContext): Promise<SmsSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SMS_KEY } });
    return row ? { ...DEFAULT_SMS, ...(row.value as Partial<SmsSettings>) } : DEFAULT_SMS;
  }

  async setSmsSettings(ctx: TenantRequestContext, dto: UpdateWarrantySmsSettingsDto): Promise<SmsSettings> {
    const value = { ...dto, quickTemplates: dto.quickTemplates.map((t) => ({ title: t.title, text: t.text })) };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: SMS_KEY },
      update: { value },
      create: { ...SMS_KEY, value },
    });
    return this.getSmsSettings(ctx);
  }

  serviceStatusLabels(): Record<string, string> {
    return SERVICE_STATUS_LABELS;
  }

  /* ───────────────────────── صدور خودکار از فاکتور ───────────────────────── */

  /**
   * وقتی فاکتور فروش کامل تسویه می‌شود (InvoicesService.recordPayment) از
   * آنجا صدا زده می‌شود. خودش چک می‌کند تننت ماژول گارانتی را نصب کرده یا نه
   * (مثل self-guard خود AutomationEngineService.emit) تا SalesModule بدون
   * قید و شرط به این متد وابسته بماند و برای تننت‌هایی که این ماژول را نصب
   * نکرده‌اند کاملاً بی‌اثر باشد. خطای احتمالی اینجا هرگز نباید ثبت پرداخت
   * فاکتور را با شکست مواجه کند — چون از داخل یک تلاش try/catch در
   * InvoicesService صدا زده می‌شود.
   */
  async issueForInvoicePaid(ctx: TenantRequestContext, invoiceId: string): Promise<void> {
    const installed = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: ctx.tenantId, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: MODULE_CODE } },
    });
    if (!installed) return;

    await this.issueForInvoiceLines(ctx, invoiceId, null);
  }

  /** صدور دستی — کارمند می‌تواند مستقل از وضعیت پرداخت فاکتور، صدور را زودتر انجام دهد. */
  async issueFromInvoiceNow(ctx: TenantRequestContext, invoiceId: string, lineIds?: string[]) {
    return this.issueForInvoiceLines(ctx, invoiceId, lineIds ?? null);
  }

  private async issueForInvoiceLines(ctx: TenantRequestContext, invoiceId: string, onlyLineIds: string[] | null) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true },
    });
    if (!invoice) return { issued: [] as string[], alreadyIssued: [] as string[] };

    const general = await this.getGeneralSettings(ctx);
    const issued: string[] = [];
    const alreadyIssued: string[] = [];

    for (const line of invoice.lines) {
      if (onlyLineIds && !onlyLineIds.includes(line.id)) continue;
      if (!line.productId) continue;

      const existingCount = await ctx.tenantDb.warrantyCode.count({ where: { invoiceLineId: line.id } });
      if (existingCount > 0) {
        alreadyIssued.push(line.description);
        continue;
      }

      const product = await ctx.tenantDb.product.findUnique({ where: { id: line.productId } });
      if (!product || !product.warrantyEnabled) continue;

      const durationDays = product.warrantyDurationDays ?? general.defaultDurationDays;
      const qty = Math.max(1, line.quantity);

      for (let i = 0; i < qty; i++) {
        const code = await generateWarrantyCode(ctx);
        await ctx.tenantDb.warrantyCode.create({
          data: {
            code,
            productId: product.id,
            itemDescription: line.description,
            invoiceId: invoice.id,
            invoiceLineId: line.id,
            contactId: invoice.contactId,
            durationDays,
            status: 'PENDING',
          },
        });
        issued.push(code);
      }
    }

    return { issued, alreadyIssued };
  }

  /* ───────────────────────── لیست/جزئیات ───────────────────────── */

  async listCodes(ctx: TenantRequestContext, filters: { status?: string; search?: string; invoiceId?: string; noInvoice?: boolean }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.noInvoice) where.invoiceId = null;
    else if (filters.invoiceId) where.invoiceId = filters.invoiceId;

    if (filters.search) {
      const term = filters.search.trim();
      const normalizedCode = term.toUpperCase().replace(/-/g, '');
      where.OR = [
        { code: { contains: normalizedCode, mode: 'insensitive' } },
        { activatedByPhone: { contains: term } },
        { activatedByName: { contains: term, mode: 'insensitive' } },
      ];
    }

    return ctx.tenantDb.warrantyCode.findMany({ where, include: CODE_INCLUDE, orderBy: { issuedAt: 'desc' } });
  }

  /** لیست گروه‌بندی‌شده به تفکیک فاکتور — برای نمایش خلاصه در صفحه اصلی. */
  async getInvoiceGroups(ctx: TenantRequestContext) {
    const rows = await ctx.tenantDb.warrantyCode.groupBy({
      by: ['invoiceId'],
      _count: { _all: true },
      _min: { issuedAt: true },
      _max: { issuedAt: true },
    });

    const invoiceIds = rows.map((r) => r.invoiceId).filter((id): id is string => id != null);
    const invoices = invoiceIds.length
      ? await ctx.tenantDb.salesInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNo: true, contact: { select: { name: true } } } })
      : [];
    const byId = new Map(invoices.map((i) => [i.id, i]));

    return rows
      .map((r) => ({
        invoiceId: r.invoiceId,
        invoiceNo: r.invoiceId ? byId.get(r.invoiceId)?.invoiceNo ?? null : null,
        contactName: r.invoiceId ? byId.get(r.invoiceId)?.contact.name ?? null : null,
        totalCodes: r._count._all,
        firstIssued: r._min.issuedAt,
        lastIssued: r._max.issuedAt,
      }))
      .sort((a, b) => {
        if (a.invoiceId === null) return 1;
        if (b.invoiceId === null) return -1;
        return (b.invoiceNo ?? 0) - (a.invoiceNo ?? 0);
      });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const code = await ctx.tenantDb.warrantyCode.findUnique({
      where: { id },
      include: { ...CODE_INCLUDE, services: { orderBy: { createdAt: 'desc' } } },
    });
    if (!code) throw new NotFoundException('این گارانتی یافت نشد');
    return code;
  }

  async void(ctx: TenantRequestContext, id: string) {
    await ctx.tenantDb.warrantyCode.update({ where: { id }, data: { status: 'VOID' } });
    return this.detail(ctx, id);
  }

  async extend(ctx: TenantRequestContext, id: string, expiresAt: string) {
    await ctx.tenantDb.warrantyCode.update({ where: { id }, data: { expiresAt: new Date(expiresAt), status: 'ACTIVE' } });
    return this.detail(ctx, id);
  }

  async deleteMany(ctx: TenantRequestContext, ids: string[]) {
    await ctx.tenantDb.warrantyCode.deleteMany({ where: { id: { in: ids } } });
    return { ok: true };
  }

  /* ───────────────────────── صدور دستی ───────────────────────── */

  async searchInvoices(ctx: TenantRequestContext, term: string) {
    const t = (term ?? '').trim();
    const where = t
      ? {
          OR: [
            { invoiceNo: Number.isNaN(Number(t)) ? undefined : Number(t) },
            { contact: { name: { contains: t, mode: 'insensitive' as const } } },
          ].filter(Boolean) as Record<string, unknown>[],
        }
      : {};

    const invoices = await ctx.tenantDb.salesInvoice.findMany({
      where,
      include: { contact: { select: { name: true } } },
      orderBy: { invoiceNo: 'desc' },
      take: 15,
    });

    return invoices.map((inv) => ({ id: inv.id, label: `#${inv.invoiceNo} — ${inv.contact.name}` }));
  }

  async invoiceSummary(ctx: TenantRequestContext, invoiceId: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: { contact: { select: { id: true, name: true } }, lines: { include: { product: { select: { id: true, name: true, warrantyEnabled: true } } } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');

    const issuedLineIds = new Set(
      (await ctx.tenantDb.warrantyCode.findMany({ where: { invoiceLineId: { in: invoice.lines.map((l) => l.id) } }, select: { invoiceLineId: true } })).map(
        (r) => r.invoiceLineId,
      ),
    );

    return {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      contactId: invoice.contact.id,
      contactName: invoice.contact.name,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        warrantyEligible: Boolean(l.product?.warrantyEnabled),
        alreadyIssued: issuedLineIds.has(l.id),
      })),
    };
  }

  async manualIssue(ctx: TenantRequestContext, dto: ManualIssueDto) {
    const product = await ctx.tenantDb.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('این کالا یافت نشد');

    const general = await this.getGeneralSettings(ctx);
    const durationDays = dto.durationDays ?? product.warrantyDurationDays ?? general.defaultDurationDays;
    const createdByUserId = await resolveTenantUserId(ctx);

    const codes: string[] = [];
    for (let i = 0; i < dto.quantity; i++) {
      const code = await generateWarrantyCode(ctx);
      await ctx.tenantDb.warrantyCode.create({
        data: {
          code,
          productId: product.id,
          itemDescription: product.name,
          contactId: dto.contactId,
          serialNumber: dto.quantity === 1 ? dto.serialNumber : undefined,
          manualInvoiceNumber: dto.manualInvoiceNumber,
          durationDays,
          status: 'PENDING',
          createdByUserId,
        },
      });
      codes.push(code);
    }
    return { codes };
  }

  /* ───────────────────────── تنظیمات کالا ───────────────────────── */

  async listProducts(ctx: TenantRequestContext) {
    return ctx.tenantDb.product.findMany({
      select: { id: true, sku: true, name: true, warrantyEnabled: true, warrantyDurationDays: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateProductSettings(ctx: TenantRequestContext, productId: string, dto: UpdateProductWarrantySettingsDto) {
    const product = await ctx.tenantDb.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('این کالا یافت نشد');

    return ctx.tenantDb.product.update({
      where: { id: productId },
      data: { warrantyEnabled: dto.warrantyEnabled, warrantyDurationDays: dto.warrantyDurationDays },
      select: { id: true, sku: true, name: true, warrantyEnabled: true, warrantyDurationDays: true },
    });
  }

  /* ───────────────────────── خدمات پس از فروش ───────────────────────── */

  async listServices(ctx: TenantRequestContext, status?: string) {
    return ctx.tenantDb.warrantyServiceRequest.findMany({
      where: status ? { status: status as never } : {},
      include: { warranty: { select: { code: true, itemDescription: true, activatedByName: true, activatedByPhone: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async serviceDetail(ctx: TenantRequestContext, id: string) {
    const service = await ctx.tenantDb.warrantyServiceRequest.findUnique({
      where: { id },
      include: { warranty: { include: CODE_INCLUDE } },
    });
    if (!service) throw new NotFoundException('این درخواست خدمات یافت نشد');
    return service;
  }

  async updateServiceStatus(ctx: TenantRequestContext, id: string, dto: UpdateServiceStatusDto) {
    const existing = await ctx.tenantDb.warrantyServiceRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این درخواست خدمات یافت نشد');

    const resolvedAt = !existing.resolvedAt && (dto.status === 'RESOLVED' || dto.status === 'CLOSED') ? new Date() : undefined;

    await ctx.tenantDb.warrantyServiceRequest.update({
      where: { id },
      data: { status: dto.status, staffNotes: dto.staffNotes, resolvedAt },
    });

    const service = await this.serviceDetail(ctx, id);
    await this.triggerServiceStatusSms(ctx, service, dto.status);
    return service;
  }

  async sendCustomSmsToServiceCustomer(ctx: TenantRequestContext, serviceId: string, message: string) {
    const service = await this.serviceDetail(ctx, serviceId);
    const warranty = service.warranty;
    if (!warranty.activatedByPhone) throw new BadRequestException('برای این گارانتی شماره موبایلی ثبت نشده است');

    const rendered = renderTemplate(message, { name: warranty.activatedByName ?? '', code: warranty.code });
    const result = await this.sms.sendSms(warranty.activatedByPhone, rendered);
    if (!result.success) throw new BadRequestException(result.error);
    return { ok: true };
  }

  /* ───────────────────────── گزارش‌ها ───────────────────────── */

  async getReportsData(ctx: TenantRequestContext) {
    const [totalCodes, statusRows, totalServices, serviceStatusRows, topItemsByService, ratingAgg, resolutionAgg, topItemsByActivation, topContacts] =
      await Promise.all([
        ctx.tenantDb.warrantyCode.count(),
        ctx.tenantDb.warrantyCode.groupBy({ by: ['status'], _count: { _all: true } }),
        ctx.tenantDb.warrantyServiceRequest.count(),
        ctx.tenantDb.warrantyServiceRequest.groupBy({ by: ['status'], _count: { _all: true } }),
        ctx.tenantDb.warrantyServiceRequest.groupBy({
          by: ['warrantyId'],
          _count: { _all: true },
          orderBy: { _count: { warrantyId: 'desc' } },
          take: 5,
        }),
        ctx.tenantDb.warrantyServiceRequest.aggregate({ _avg: { customerRating: true }, _count: { customerRating: true } }),
        ctx.tenantDb.$queryRaw<{ avg_hours: number | null; resolved_count: bigint }[]>`
          SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600) as avg_hours, COUNT(*) as resolved_count
          FROM warranty_service_requests WHERE "resolvedAt" IS NOT NULL
        `,
        ctx.tenantDb.warrantyCode.groupBy({
          by: ['productId', 'itemDescription'],
          where: { activatedAt: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { productId: 'desc' } },
          take: 10,
        }),
        ctx.tenantDb.warrantyCode.groupBy({
          by: ['contactId'],
          where: { invoiceId: { not: null }, contactId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { contactId: 'desc' } },
          take: 10,
        }),
      ]);

    const contactIds = topContacts.map((c) => c.contactId).filter((id): id is string => id != null);
    const contacts = contactIds.length ? await ctx.tenantDb.crmContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } }) : [];
    const contactById = new Map(contacts.map((c) => [c.id, c.name]));

    const warrantyIds = topItemsByService.map((r) => r.warrantyId);
    const warranties = warrantyIds.length ? await ctx.tenantDb.warrantyCode.findMany({ where: { id: { in: warrantyIds } }, select: { id: true, itemDescription: true } }) : [];
    const warrantyDescById = new Map(warranties.map((w) => [w.id, w.itemDescription]));

    return {
      totalCodes,
      statusBreakdown: Object.fromEntries(statusRows.map((r) => [r.status, r._count._all])),
      totalServices,
      serviceStatusBreakdown: Object.fromEntries(serviceStatusRows.map((r) => [r.status, r._count._all])),
      topItemsByService: topItemsByService.map((r) => ({ itemDescription: warrantyDescById.get(r.warrantyId) ?? '', total: r._count._all })),
      avgRating: ratingAgg._avg.customerRating != null ? Math.round(ratingAgg._avg.customerRating * 10) / 10 : null,
      ratingCount: ratingAgg._count.customerRating,
      avgResolutionHours: resolutionAgg[0]?.avg_hours != null ? Math.round(Number(resolutionAgg[0].avg_hours) * 10) / 10 : null,
      resolvedCount: resolutionAgg[0] ? Number(resolutionAgg[0].resolved_count) : 0,
      topItemsByActivation: topItemsByActivation.map((r) => ({ itemDescription: r.itemDescription ?? '', total: r._count._all })),
      topContactsByActivation: topContacts.map((r) => ({ contactId: r.contactId, name: r.contactId ? contactById.get(r.contactId) ?? '' : '', total: r._count._all })),
    };
  }

  /* ───────────────────────── وارد کردن گارانتی‌های قدیمی ───────────────────────── */

  async importLegacyRows(ctx: TenantRequestContext, rows: ImportLegacyWarrantyRowDto[]) {
    const general = await this.getGeneralSettings(ctx);
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const code = row.code.trim().toUpperCase();
      if (!code) {
        skipped++;
        continue;
      }
      const existing = await ctx.tenantDb.warrantyCode.findUnique({ where: { code } });
      if (existing) {
        skipped++;
        continue;
      }

      let status = (row.status ?? '').trim().toUpperCase();
      if (!['ACTIVE', 'PENDING', 'EXPIRED', 'VOID'].includes(status)) status = 'ACTIVE';

      const durationDays = Number(row.durationDays) > 0 ? Number(row.durationDays) : general.defaultDurationDays;
      const issuedAt = row.issuedAt ? new Date(row.issuedAt) : new Date();

      let activatedAt: Date | null = null;
      let expiresAt: Date | null = null;
      if (status === 'ACTIVE' || status === 'EXPIRED') {
        activatedAt = row.activatedAt ? new Date(row.activatedAt) : issuedAt;
        expiresAt = row.expiresAt ? new Date(row.expiresAt) : new Date(activatedAt.getTime() + durationDays * 86_400_000);
        if (status === 'ACTIVE' && expiresAt.getTime() < Date.now()) status = 'EXPIRED';
      }

      let contactId: string | undefined;
      const phone = row.clientPhone?.trim();
      if (phone) {
        const contact = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
        contactId = contact
          ? contact.id
          : (
              await ctx.tenantDb.crmContact.create({
                data: { name: row.clientName?.trim() || phone, phone, isCustomer: true, source: 'وارد شده از سیستم قبلی گارانتی' },
              })
            ).id;
      }

      await ctx.tenantDb.warrantyCode.create({
        data: {
          code,
          itemDescription: row.itemDescription?.trim(),
          manualInvoiceNumber: row.invoiceNumber?.trim() || undefined,
          serialNumber: row.serialNumber?.trim() || undefined,
          durationDays,
          status: status as never,
          issuedAt,
          activatedAt,
          expiresAt,
          contactId,
          activatedByName: row.clientName?.trim() || undefined,
          activatedByPhone: phone || undefined,
          activatedByEmail: row.clientEmail?.trim() || undefined,
        },
      });
      imported++;
    }

    return { imported, skipped };
  }

  /* ───────────────────────── نگهبان‌های زمان‌بندی‌شده (کرون) ───────────────────────── */

  async markExpired(ctx: TenantRequestContext) {
    const result = await ctx.tenantDb.warrantyCode.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  /* ───────────────────────── پیامک (تریگرها) ───────────────────────── */

  async triggerActivationSms(ctx: TenantRequestContext, warranty: { code: string; activatedByName: string | null; activatedByPhone: string | null }) {
    const settings = await this.getSmsSettings(ctx);
    if (!settings.enabled) return;

    if (settings.activationCustomerEnabled && warranty.activatedByPhone) {
      const message = renderTemplate(settings.activationCustomerTemplate, { name: warranty.activatedByName ?? '', code: warranty.code });
      await this.sms.sendSms(warranty.activatedByPhone, message);
    }

    if (settings.activationStaffEnabled) {
      await this.notifyManagers(ctx, `یک مشتری گارانتی خود را فعال کرد. کد گارانتی: ${warranty.code}`, '/warranty');
    }
  }

  async notifyServiceRequested(ctx: TenantRequestContext, warranty: { code: string }) {
    const settings = await this.getSmsSettings(ctx);
    if (settings.enabled && settings.serviceNewStaffEnabled) {
      // پیامک به کارمند مسئول از طریق شماره‌ی خودِ کارمندان مدیر (نه یک شماره‌ی خاص انتخابی)
    }
    await this.notifyManagers(ctx, `یک مشتری درخواست خدمات پس از فروش ثبت کرد. کد گارانتی: ${warranty.code}`, '/warranty/services');
  }

  private async triggerServiceStatusSms(
    ctx: TenantRequestContext,
    service: { status: string; warranty: { code: string; activatedByName: string | null; activatedByPhone: string | null } },
    newStatus: string,
  ) {
    const settings = await this.getSmsSettings(ctx);
    if (!settings.enabled) return;

    const statusLabel = SERVICE_STATUS_LABELS[newStatus] ?? newStatus;

    if (settings.serviceStatusCustomerEnabled && service.warranty.activatedByPhone) {
      const message = renderTemplate(settings.serviceStatusCustomerTemplate, {
        name: service.warranty.activatedByName ?? '',
        code: service.warranty.code,
        status: statusLabel,
      });
      await this.sms.sendSms(service.warranty.activatedByPhone, message);
    }
  }

  private async notifyManagers(ctx: TenantRequestContext, message: string, link: string) {
    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    for (const manager of managers) {
      await this.notifications.notify(ctx.tenantDb, {
        userId: manager.tenantUserId,
        type: 'warranty.notice',
        title: 'گارانتی و خدمات پس از فروش',
        body: message,
        link,
      });
    }
  }
}
