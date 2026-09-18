import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

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
    await tenantDb.resellerProfile.create({
      data: {
        contactId: contact.id,
        websiteUrl: application.websiteUrl,
        city: application.city,
        productCode: application.productCode as never,
      },
    });

    return this.controlDb.resellerApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewedByAdminId: adminId, reviewedAt: new Date() },
    });
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
