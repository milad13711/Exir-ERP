import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

/**
 * Every StockMovement needs a warehouseId. New tenants get one seeded by the
 * `add_warehouses` migration itself; this is just a safety net (e.g. for a
 * tenant DB whose migration history predates that seed row somehow) so
 * system-generated movements (invoice confirm, PO receive, returns) never
 * hit a missing-warehouse error.
 */
export async function ensureDefaultWarehouse(db: TenantPrismaClient): Promise<{ id: string }> {
  const existing = await db.warehouse.findFirst({ where: { isDefault: true } });
  if (existing) return existing;

  const any = await db.warehouse.findFirst();
  if (any) return any;

  try {
    return await db.warehouse.create({
      data: { name: 'انبار مرکزی', code: 'MAIN', isDefault: true },
    });
  } catch (err) {
    // Race: another concurrent request already created it.
    const isUniqueConstraintViolation =
      typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
    if (!isUniqueConstraintViolation) throw err;
    const created = await db.warehouse.findFirst({ where: { isDefault: true } });
    if (!created) throw err;
    return created;
  }
}
