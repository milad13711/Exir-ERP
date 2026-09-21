import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ResellersService } from '../referral-marketing/resellers.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { UpdateResellerApplicationDto } from './dto/update-reseller-application.dto.js';

/**
 * بررسی درخواست‌های همکاری در فروش (از فرم عمومی eta.co.ir) توسط تیم
 * مدیریت. approve یک نماینده‌ی واقعی (CrmContact + ResellerProfile) در
 * تننت رجیستری پلتفرم (eta) می‌سازد — دقیقاً همان مدلی که ماژول رفرال
 * برای هر نماینده‌ی دیگری استفاده می‌کند؛ اعطای دسترسی ورود بعداً از همان
 * پنل ماژول رفرال روی eta انجام می‌شود، نه اینجا.
 */
@Injectable()
export class ResellerApplicationsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly resellers: ResellersService,
  ) {}

  private get registrySlug(): string {
    return process.env.RESELLER_REGISTRY_TENANT_SLUG ?? 'eta';
  }

  list(status?: string) {
    return this.controlDb.resellerApplication.findMany({
      where: { status: status as never },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const application = await this.controlDb.resellerApplication.findUnique({ where: { id }, include: { reviewedBy: { select: { name: true } } } });
    if (!application) throw new NotFoundException('درخواست یافت نشد');
    return application;
  }

  async update(id: string, dto: UpdateResellerApplicationDto) {
    await this.get(id);
    return this.controlDb.resellerApplication.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const application = await this.get(id);
    if (application.status === 'APPROVED') {
      throw new BadRequestException('درخواست تأییدشده حذف نمی‌شود؛ نماینده‌ی ساخته‌شده را از ماژول رفرال مدیریت کنید');
    }
    await this.controlDb.resellerApplication.delete({ where: { id } });
    return { success: true };
  }

  async approve(id: string, adminId: string) {
    const application = await this.controlDb.resellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('درخواست یافت نشد');
    if (application.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');

    const registryTenant = await this.controlDb.tenant.findUnique({ where: { slug: this.registrySlug } });
    if (!registryTenant) throw new BadRequestException('تننت رجیستری پلتفرم پیدا نشد');
    const tenantDb = this.tenantPrisma.forTenant(registryTenant);

    const contact = await tenantDb.crmContact.create({
      data: {
        name: application.name,
        company: application.company,
        phone: application.phone,
        email: application.email,
        type: application.company ? 'COMPANY' : 'INDIVIDUAL',
        isCustomer: false,
        isSupplier: true,
      },
    });
    // تأیید ادمین = احراز نماینده: همان لحظه روی نقشه‌ی همکاران eta.co.ir پین می‌شود (شهر + محصول).
    const profile = await tenantDb.resellerProfile.create({
      data: {
        contactId: contact.id,
        websiteUrl: application.websiteUrl,
        city: application.city,
        productCode: application.productCode as never,
        isVerified: true,
        verifiedAt: new Date(),
      },
    });

    // پروفایل + دسترسی ورود: نماینده پیامک ورود می‌گیرد و می‌تواند عکس و اطلاعاتش را برای پین نقشه بارگذاری کند.
    let accessGranted = false;
    let accessError: string | null = null;
    try {
      const ctx = { tenantId: registryTenant.id, tenantSlug: registryTenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
      await this.resellers.grantAccess(ctx, profile.id);
      accessGranted = true;
    } catch (err) {
      accessError = err instanceof Error ? err.message : 'اعطای دسترسی ناموفق بود';
    }

    const updated = await this.controlDb.resellerApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewedByAdminId: adminId, reviewedAt: new Date() },
    });
    return { ...updated, accessGranted, accessError, pinnedOnMap: !!application.city };
  }

  async reject(id: string, adminId: string, rejectionNote?: string) {
    const application = await this.controlDb.resellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('درخواست یافت نشد');
    if (application.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');

    return this.controlDb.resellerApplication.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByAdminId: adminId, reviewedAt: new Date(), rejectionNote },
    });
  }
}
