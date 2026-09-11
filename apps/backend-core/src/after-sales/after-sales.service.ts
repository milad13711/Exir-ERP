import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { UpdateServiceStatusDto } from './dto/update-service-status.dto.js';
import type { UpdateAfterSalesGeneralSettingsDto } from './dto/update-general-settings.dto.js';
import type { UpdateAfterSalesSmsSettingsDto } from './dto/update-sms-settings.dto.js';

export const AFTER_SALES_MODULE_CODE = 'after-sales-service';
const GENERAL_KEY = { moduleCode: AFTER_SALES_MODULE_CODE, key: 'general' } as const;
const SMS_KEY = { moduleCode: AFTER_SALES_MODULE_CODE, key: 'sms' } as const;

type GeneralSettings = {
  serviceTermsConditions: string;
  serviceManagerUserId: string | null;
};

const DEFAULT_GENERAL: GeneralSettings = {
  serviceTermsConditions: '',
  serviceManagerUserId: null,
};

type SmsSettings = {
  enabled: boolean;
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

/**
 * ماژول مستقل خدمات پس از فروش — روی گارانتی فعال‌شده سوار می‌شود
 * (dependsOn: ['warranty']) اما هیچ وابستگی کد به WarrantyModule ندارد؛ فقط
 * از همان جدول‌های Prisma مشترک (warrantyCode/warrantyServiceRequest) در
 * tenantDb خودش می‌خواند/می‌نویسد — دقیقاً همان الگوی «وابستگی از طریق
 * دیتابیس مشترک، نه import ماژول» که در سایر جاهای این سیستم هم استفاده
 * شده (مثل fleet که مستقیم به sales_invoices کوئری می‌زند).
 */
@Injectable()
export class AfterSalesService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
    private readonly notifications: NotificationsService,
  ) {}

  async isInstalled(ctx: TenantRequestContext): Promise<boolean> {
    const row = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: ctx.tenantId, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: AFTER_SALES_MODULE_CODE } },
    });
    return Boolean(row);
  }

  /* ───────────────────────── تنظیمات ───────────────────────── */

  async getGeneralSettings(ctx: TenantRequestContext): Promise<GeneralSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: GENERAL_KEY } });
    return row ? { ...DEFAULT_GENERAL, ...(row.value as Partial<GeneralSettings>) } : DEFAULT_GENERAL;
  }

  async setGeneralSettings(ctx: TenantRequestContext, dto: UpdateAfterSalesGeneralSettingsDto): Promise<GeneralSettings> {
    const value = { ...dto };
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: GENERAL_KEY }, update: { value }, create: { ...GENERAL_KEY, value } });
    return this.getGeneralSettings(ctx);
  }

  async getSmsSettings(ctx: TenantRequestContext): Promise<SmsSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SMS_KEY } });
    return row ? { ...DEFAULT_SMS, ...(row.value as Partial<SmsSettings>) } : DEFAULT_SMS;
  }

  async setSmsSettings(ctx: TenantRequestContext, dto: UpdateAfterSalesSmsSettingsDto): Promise<SmsSettings> {
    const value = { ...dto, quickTemplates: dto.quickTemplates.map((t) => ({ title: t.title, text: t.text })) };
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SMS_KEY }, update: { value }, create: { ...SMS_KEY, value } });
    return this.getSmsSettings(ctx);
  }

  serviceStatusLabels(): Record<string, string> {
    return SERVICE_STATUS_LABELS;
  }

  /* ───────────────────────── درخواست‌های خدمات ───────────────────────── */

  async listServices(ctx: TenantRequestContext, status?: string) {
    return ctx.tenantDb.warrantyServiceRequest.findMany({
      where: status ? { status: status as never } : {},
      include: { warranty: { select: { code: true, itemDescription: true, activatedByName: true, activatedByPhone: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async serviceDetail(ctx: TenantRequestContext, id: string) {
    const service = await ctx.tenantDb.warrantyServiceRequest.findUnique({ where: { id }, include: { warranty: { include: CODE_INCLUDE } } });
    if (!service) throw new NotFoundException('این درخواست خدمات یافت نشد');
    return service;
  }

  async updateServiceStatus(ctx: TenantRequestContext, id: string, dto: UpdateServiceStatusDto) {
    const existing = await ctx.tenantDb.warrantyServiceRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این درخواست خدمات یافت نشد');

    const resolvedAt = !existing.resolvedAt && (dto.status === 'RESOLVED' || dto.status === 'CLOSED') ? new Date() : undefined;
    await ctx.tenantDb.warrantyServiceRequest.update({ where: { id }, data: { status: dto.status, staffNotes: dto.staffNotes, resolvedAt } });

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
    const [totalServices, serviceStatusRows, topItemsByService, ratingAgg, resolutionAgg] = await Promise.all([
      ctx.tenantDb.warrantyServiceRequest.count(),
      ctx.tenantDb.warrantyServiceRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      ctx.tenantDb.warrantyServiceRequest.groupBy({ by: ['warrantyId'], _count: { _all: true }, orderBy: { _count: { warrantyId: 'desc' } }, take: 5 }),
      ctx.tenantDb.warrantyServiceRequest.aggregate({ _avg: { customerRating: true }, _count: { customerRating: true } }),
      ctx.tenantDb.$queryRaw<{ avg_hours: number | null; resolved_count: bigint }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600) as avg_hours, COUNT(*) as resolved_count
        FROM warranty_service_requests WHERE "resolvedAt" IS NOT NULL
      `,
    ]);

    const warrantyIds = topItemsByService.map((r) => r.warrantyId);
    const warranties = warrantyIds.length ? await ctx.tenantDb.warrantyCode.findMany({ where: { id: { in: warrantyIds } }, select: { id: true, itemDescription: true } }) : [];
    const warrantyDescById = new Map(warranties.map((w) => [w.id, w.itemDescription]));

    return {
      totalServices,
      serviceStatusBreakdown: Object.fromEntries(serviceStatusRows.map((r) => [r.status, r._count._all])),
      topItemsByService: topItemsByService.map((r) => ({ itemDescription: warrantyDescById.get(r.warrantyId) ?? '', total: r._count._all })),
      avgRating: ratingAgg._avg.customerRating != null ? Math.round(ratingAgg._avg.customerRating * 10) / 10 : null,
      ratingCount: ratingAgg._count.customerRating,
      avgResolutionHours: resolutionAgg[0]?.avg_hours != null ? Math.round(Number(resolutionAgg[0].avg_hours) * 10) / 10 : null,
      resolvedCount: resolutionAgg[0] ? Number(resolutionAgg[0].resolved_count) : 0,
    };
  }

  /* ───────────────────────── پیامک (تریگرها) ───────────────────────── */

  async notifyServiceRequested(ctx: TenantRequestContext, warranty: { code: string; activatedByName: string | null }) {
    const settings = await this.getSmsSettings(ctx);
    const general = await this.getGeneralSettings(ctx);

    if (!settings.serviceNewStaffEnabled) return;
    const staffMessage = settings.enabled
      ? renderTemplate(settings.serviceNewStaffTemplate, { name: warranty.activatedByName ?? '', code: warranty.code })
      : undefined;
    await this.notifyStaffOrManagers(
      ctx,
      general.serviceManagerUserId,
      `یک مشتری درخواست خدمات پس از فروش ثبت کرد. کد گارانتی: ${warranty.code}`,
      '/after-sales',
      staffMessage,
    );
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

    if (settings.serviceStatusStaffEnabled) {
      const general = await this.getGeneralSettings(ctx);
      const staffMessage = renderTemplate(settings.serviceStatusStaffTemplate, {
        name: service.warranty.activatedByName ?? '',
        code: service.warranty.code,
        status: statusLabel,
      });
      await this.notifyStaffOrManagers(ctx, general.serviceManagerUserId, `وضعیت درخواست خدمات کد ${service.warranty.code} به «${statusLabel}» تغییر کرد.`, '/after-sales', staffMessage);
    }
  }

  private async notifyStaffOrManagers(ctx: TenantRequestContext, staffUserId: string | null, message: string, link: string, smsText?: string) {
    if (staffUserId) {
      const staff = await ctx.tenantDb.user.findUnique({ where: { id: staffUserId } });
      if (staff) {
        await this.notifications.notify(ctx.tenantDb, { userId: staff.id, type: 'after-sales.notice', title: 'خدمات پس از فروش', body: message, link });
        if (smsText && staff.phone) await this.sms.sendSms(staff.phone, smsText);
        return;
      }
    }
    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    for (const manager of managers) {
      await this.notifications.notify(ctx.tenantDb, { userId: manager.tenantUserId, type: 'after-sales.notice', title: 'خدمات پس از فروش', body: message, link });
    }
  }
}
