import { Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/**
 * داده‌ی نقشه‌ی نمایندگان برای صفحه‌ی «همکاری با ما» در eta.co.ir — فقط
 * نمایندگان احرازشده‌ی تننت رجیستری پلتفرم (همان تننتی که ReferralSyncService
 * و ماژول رفرال eta روی آن کار می‌کنند)، هرکدام با شهر و محصولی که برایش
 * فعال هستند. بدون احراز هویت — داده‌ای کاملاً عمومی (نام، شهر، محصول، لوگو).
 */
@Injectable()
export class PublicResellerMapService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  private get registrySlug(): string {
    return process.env.RESELLER_REGISTRY_TENANT_SLUG ?? 'eta';
  }

  async listForMap(productCode?: string) {
    const registryTenant = await this.controlDb.tenant.findUnique({ where: { slug: this.registrySlug } });
    if (!registryTenant) return [];
    const tenantDb = this.tenantPrisma.forTenant(registryTenant);

    const resellers = await tenantDb.resellerProfile.findMany({
      where: { isVerified: true, hiddenFromMap: false, cooperationStatus: { not: 'ENDED' }, city: { not: null }, productCode: productCode ? (productCode as never) : undefined },
      select: {
        id: true,
        city: true,
        productCode: true,
        tier: true,
        logoUrl: true,
        websiteUrl: true,
        bio: true,
        contact: { select: { name: true, company: true } },
      },
    });

    return resellers.map((r) => ({
      id: r.id,
      name: r.contact.company || r.contact.name,
      city: r.city,
      productCode: r.productCode,
      tier: r.tier,
      logoUrl: r.logoUrl,
      websiteUrl: r.websiteUrl,
      bio: r.bio,
    }));
  }
}
