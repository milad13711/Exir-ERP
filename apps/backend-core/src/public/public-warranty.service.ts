import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { WarrantyService } from '../warranty/warranty.service.js';
import { normalizeWarrantyCode } from '../warranty/warranty-code.util.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { ActivateWarrantyDto } from './dto/activate-warranty.dto.js';
import type { RequestWarrantyServiceDto } from './dto/request-warranty-service.dto.js';
import type { WarrantyServiceFeedbackDto } from './dto/warranty-service-feedback.dto.js';

/**
 * بدون ورود و بدون OTP — مثل ماژول فرم‌ساز، این هم صرفاً یک استعلام/فعال‌سازی
 * است نه خرید یا رزرو ظرفیت واقعی، پس اصطکاک OTP توجیهی ندارد. هویت مشتری
 * (تماس CRM) بر اساس شماره موبایلی که خودش هنگام فعال‌سازی وارد می‌کند
 * resolve/create می‌شود — همان الگوی مشترک هویت-با-شماره در این سیستم.
 */
@Injectable()
export class PublicWarrantyService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly automation: AutomationEngineService,
    private readonly warranty: WarrantyService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const warrantyModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'warranty' } },
    });
    if (!warrantyModule) throw new NotFoundException('این خدمت در دسترس نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  private async findByCode(ctx: TenantRequestContext, rawCode: string) {
    const code = normalizeWarrantyCode(rawCode);
    if (!code) return null;

    const exact = await ctx.tenantDb.warrantyCode.findUnique({ where: { code } });
    if (exact) return exact;

    // پشتیبانی از کدهای وارد‌شده با خط‌تیره یا حروف کوچک (بدون در نظر گرفتن جداکننده) — برای گارانتی‌های قدیمی وارد‌شده
    const rows = await ctx.tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM warranty_codes WHERE REPLACE(UPPER(code), '-', '') = ${code} LIMIT 1
    `;
    return rows[0] ? ctx.tenantDb.warrantyCode.findUnique({ where: { id: rows[0].id } }) : null;
  }

  private async logAttempt(ctx: TenantRequestContext, warrantyId: string | null, codeTried: string, action: string, success: boolean) {
    await ctx.tenantDb.warrantyActivationLog.create({
      data: { warrantyId, codeTried, action, success },
    });
  }

  async lookup(slug: string, rawCode: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const warranty = await this.findByCode(ctx, rawCode);
    await this.logAttempt(ctx, warranty?.id ?? null, rawCode, 'lookup', Boolean(warranty));
    if (!warranty) throw new NotFoundException('کد گارانتی یافت نشد');

    const latestService = await ctx.tenantDb.warrantyServiceRequest.findFirst({
      where: { warrantyId: warranty.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      code: warranty.code,
      itemDescription: warranty.itemDescription,
      status: warranty.status,
      issuedAt: warranty.issuedAt,
      activatedAt: warranty.activatedAt,
      expiresAt: warranty.expiresAt,
      serialNumber: warranty.serialNumber,
      canRequestService: warranty.status === 'ACTIVE',
      latestService: latestService
        ? { id: latestService.id, status: latestService.status, createdAt: latestService.createdAt, resolvedAt: latestService.resolvedAt }
        : null,
    };
  }

  async getTerms(slug: string, kind: 'warranty' | 'service') {
    const ctx = await this.resolveTenantCtx(slug);
    const settings = await this.warranty.getGeneralSettings(ctx);
    return { text: kind === 'warranty' ? settings.termsConditions : settings.serviceTermsConditions };
  }

  private async resolveOrCreateContact(ctx: TenantRequestContext, name: string, phone: string) {
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
    if (existing) return existing;
    return ctx.tenantDb.crmContact.create({ data: { name: name || phone, phone, isCustomer: true, source: 'فعال‌سازی گارانتی' } });
  }

  async activate(slug: string, dto: ActivateWarrantyDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const warranty = await this.findByCode(ctx, dto.code);
    await this.logAttempt(ctx, warranty?.id ?? null, dto.code, 'activate', false);
    if (!warranty) throw new NotFoundException('کد گارانتی یافت نشد');
    if (warranty.status !== 'PENDING') throw new BadRequestException('این گارانتی قبلاً فعال شده یا نامعتبر است');

    const settings = await this.warranty.getGeneralSettings(ctx);
    if (settings.termsConditions.trim() && !dto.termsAccepted) {
      throw new BadRequestException('پذیرش شرایط و ضوابط الزامی است');
    }

    const activatedAt = new Date();
    const expiresAt = new Date(activatedAt.getTime() + warranty.durationDays * 86_400_000);
    const contact = await this.resolveOrCreateContact(ctx, dto.name, dto.phone);

    await ctx.tenantDb.warrantyCode.update({
      where: { id: warranty.id },
      data: {
        status: 'ACTIVE',
        activatedAt,
        expiresAt,
        activatedByName: dto.name,
        activatedByPhone: dto.phone,
        activatedByEmail: dto.email,
        termsAcceptedAt: dto.termsAccepted ? activatedAt : undefined,
        productPhoto: dto.productPhoto,
        contactId: warranty.contactId ?? contact.id,
      },
    });

    await ctx.tenantDb.warrantyActivationLog.create({ data: { warrantyId: warranty.id, codeTried: dto.code, action: 'activate', success: true } });

    await this.warranty.triggerActivationSms(ctx, { code: warranty.code, activatedByName: dto.name, activatedByPhone: dto.phone });
    await this.automation.emit(ctx, 'warranty.code.activated', { code: warranty.code, customerName: dto.name, customerPhone: dto.phone });

    return { success: true, warrantyId: warranty.id, expiresAt };
  }

  async requestService(slug: string, dto: RequestWarrantyServiceDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const warranty = await this.findByCode(ctx, dto.code);
    if (!warranty) throw new NotFoundException('کد گارانتی یافت نشد');
    if (warranty.status !== 'ACTIVE') throw new BadRequestException('فقط برای گارانتی فعال می‌توان درخواست خدمات ثبت کرد');

    const service = await ctx.tenantDb.warrantyServiceRequest.create({
      data: { warrantyId: warranty.id, description: dto.description, photo: dto.photo, status: 'NEW' },
    });

    await this.warranty.notifyServiceRequested(ctx, { code: warranty.code, activatedByName: warranty.activatedByName });
    await this.automation.emit(ctx, 'warranty.service.requested', { code: warranty.code, description: dto.description });

    return { success: true, serviceId: service.id };
  }

  async submitFeedback(slug: string, serviceId: string, dto: WarrantyServiceFeedbackDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const service = await ctx.tenantDb.warrantyServiceRequest.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('این درخواست یافت نشد');
    if (!['RESOLVED', 'CLOSED'].includes(service.status)) throw new BadRequestException('این درخواست هنوز بسته نشده است');

    await ctx.tenantDb.warrantyServiceRequest.update({
      where: { id: serviceId },
      data: { customerRating: dto.rating, customerFeedback: dto.comment },
    });

    return { success: true };
  }
}
