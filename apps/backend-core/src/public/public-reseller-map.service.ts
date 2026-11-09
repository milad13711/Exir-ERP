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

  private async registryDb() {
    const registryTenant = await this.controlDb.tenant.findUnique({ where: { slug: this.registrySlug } });
    return registryTenant ? this.tenantPrisma.forTenant(registryTenant) : null;
  }

  /** محصولاتی که فرم «همکاری با ما» نشان می‌دهد — همان رجیستری محصولات ماژول نمایندگی (فقط فعال و بایگانی‌نشده). */
  async listProducts() {
    const db = await this.registryDb();
    if (!db) return [];
    const rows = await db.agentProduct.findMany({
      where: { isActive: true, isArchived: false },
      select: { code: true, name: true, description: true, logoUrl: true, websiteUrl: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ ...r, logoUrl: safeImage(r.logoUrl) }));
  }

  /**
   * پین‌های نقشه از ماژول نمایندگی: نماینده‌ی احرازشده، دارای شهر، با دست‌کم یک عضویت ACTIVE در محصول فعال.
   * productCode = کد محصول ماژول نمایندگی.
   */
  async listForMap(productCode?: string) {
    const db = await this.registryDb();
    if (!db) return [];
    const code = productCode && /^[A-Z][A-Z0-9_]{1,31}$/.test(productCode) ? productCode : undefined;
    const memberships = await db.agentProductMembership.findMany({
      where: {
        status: 'ACTIVE',
        product: { isActive: true, isArchived: false, ...(code ? { code } : {}) },
        resellerProfile: { isVerified: true, hiddenFromMap: false, city: { not: null } },
      },
      select: {
        level: true,
        product: { select: { code: true, name: true } },
        resellerProfile: {
          select: { id: true, city: true, logoUrl: true, websiteUrl: true, bio: true, contact: { select: { name: true, company: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    // یک پین به‌ازای هر نماینده؛ محصولاتش کنار هم
    const byProfile = new Map<string, { id: string; name: string; city: string | null; productCode: string; productCodes: string[]; productNames: string[]; tier: string; logoUrl: string | null; websiteUrl: string | null; bio: string | null }>();
    for (const m of memberships) {
      const r = m.resellerProfile;
      const prev = byProfile.get(r.id);
      if (prev) {
        prev.productCodes.push(m.product.code);
        prev.productNames.push(m.product.name);
        continue;
      }
      byProfile.set(r.id, {
        id: r.id,
        name: r.contact.company || r.contact.name,
        city: r.city,
        productCode: m.product.code,
        productCodes: [m.product.code],
        productNames: [m.product.name],
        tier: m.level,
        logoUrl: safeImage(r.logoUrl),
        websiteUrl: r.websiteUrl && /^https?:\/\//i.test(r.websiteUrl) ? r.websiteUrl : null,
        bio: r.bio,
      });
    }
    return [...byProfile.values()];
  }
}

/** فقط http(s) یا data:image — هیچ طرح دیگری به صفحه‌ی عمومی نمی‌رسد. */
function safeImage(u: string | null): string | null {
  if (!u) return null;
  return /^https?:\/\//i.test(u) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u) ? u : null;
}
