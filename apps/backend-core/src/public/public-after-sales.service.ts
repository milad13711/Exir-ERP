import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { AfterSalesService, AFTER_SALES_MODULE_CODE } from '../after-sales/after-sales.service.js';
import { normalizeWarrantyCode } from '../warranty/warranty-code.util.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { RequestWarrantyServiceDto } from './dto/request-warranty-service.dto.js';
import type { WarrantyServiceFeedbackDto } from './dto/warranty-service-feedback.dto.js';

/**
 * بدون ورود و بدون OTP، مستقل از PublicWarrantyService — ماژول خدمات پس از
 * فروش مستقل از ماژول گارانتی است (فقط dependsOn آن)، پس این سرویس خودش
 * مستقیماً کد گارانتی را در دیتابیس تننت پیدا می‌کند، نه با صدا زدن سرویس
 * ماژول گارانتی.
 */
@Injectable()
export class PublicAfterSalesService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly automation: AutomationEngineService,
    private readonly afterSales: AfterSalesService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const installed = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: AFTER_SALES_MODULE_CODE } },
    });
    if (!installed) throw new NotFoundException('این خدمت در دسترس نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  private async findByCode(ctx: TenantRequestContext, rawCode: string) {
    const code = normalizeWarrantyCode(rawCode);
    if (!code) return null;
    const exact = await ctx.tenantDb.warrantyCode.findUnique({ where: { code } });
    if (exact) return exact;
    const rows = await ctx.tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM warranty_codes WHERE REPLACE(UPPER(code), '-', '') = ${code} LIMIT 1
    `;
    return rows[0] ? ctx.tenantDb.warrantyCode.findUnique({ where: { id: rows[0].id } }) : null;
  }

  async getTerms(slug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const settings = await this.afterSales.getGeneralSettings(ctx);
    return { text: settings.serviceTermsConditions };
  }

  /** برای صفحه‌ی عمومی خدمات پس از فروش — وضعیت فعلی گارانتی و آخرین درخواست خدمات (اگر باشد) را برمی‌گرداند. */
  async status(slug: string, rawCode: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const warranty = await this.findByCode(ctx, rawCode);
    if (!warranty) throw new NotFoundException('کد گارانتی یافت نشد');

    const latestService = await ctx.tenantDb.warrantyServiceRequest.findFirst({ where: { warrantyId: warranty.id }, orderBy: { createdAt: 'desc' } });

    return {
      code: warranty.code,
      itemDescription: warranty.itemDescription,
      warrantyStatus: warranty.status,
      canRequestService: warranty.status === 'ACTIVE',
      latestService: latestService
        ? { id: latestService.id, status: latestService.status, createdAt: latestService.createdAt, resolvedAt: latestService.resolvedAt }
        : null,
    };
  }

  async requestService(slug: string, dto: RequestWarrantyServiceDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const warranty = await this.findByCode(ctx, dto.code);
    if (!warranty) throw new NotFoundException('کد گارانتی یافت نشد');
    if (warranty.status !== 'ACTIVE') throw new BadRequestException('فقط برای گارانتی فعال می‌توان درخواست خدمات ثبت کرد');

    const service = await ctx.tenantDb.warrantyServiceRequest.create({
      data: { warrantyId: warranty.id, description: dto.description, photo: dto.photo, status: 'NEW' },
    });

    await this.afterSales.notifyServiceRequested(ctx, { code: warranty.code, activatedByName: warranty.activatedByName });
    await this.automation.emit(ctx, 'afterSales.service.requested', { code: warranty.code, description: dto.description });

    return { success: true, serviceId: service.id };
  }

  async submitFeedback(slug: string, serviceId: string, dto: WarrantyServiceFeedbackDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const service = await ctx.tenantDb.warrantyServiceRequest.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('این درخواست یافت نشد');
    if (!['RESOLVED', 'CLOSED'].includes(service.status)) throw new BadRequestException('این درخواست هنوز بسته نشده است');

    await ctx.tenantDb.warrantyServiceRequest.update({ where: { id: serviceId }, data: { customerRating: dto.rating, customerFeedback: dto.comment } });
    return { success: true };
  }
}
