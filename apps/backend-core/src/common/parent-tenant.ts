import { platformTenantSlug } from './guards/platform-owner.guard.js';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

export type ParentTenantHandle = { tenantId: string; slug: string; name: string; tenantDb: TenantPrismaClient };

/**
 * تننت مادر (شرکت صاحب پلتفرم، env PLATFORM_TENANT_SLUG) و اتصال دیتابیسش.
 * اگر وجود نداشته باشد یا ACTIVE نباشد null برمی‌گرداند؛ فراخوان باید بی‌صدا ادامه دهد.
 */
export async function getParentTenant(controlDb: ControlPrismaService, tenantPrisma: TenantPrismaService): Promise<ParentTenantHandle | null> {
  const tenant = await controlDb.tenant.findUnique({ where: { slug: platformTenantSlug() } });
  if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') return null;
  return { tenantId: tenant.id, slug: tenant.slug, name: tenant.name, tenantDb: tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName }) };
}
