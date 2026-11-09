import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { LEGACY_PRODUCT_NAMES, tierToLevel } from './agent-backfill.js';

const LEGACY_CODES = new Set(Object.keys(LEGACY_PRODUCT_NAMES));

/**
 * مسیر قدیمی تأیید درخواست (پنل ادمین پلتفرم) فقط productCode قدیمی را دارد. این تابع (idempotent) محصول متناظر را
 * (اگر نبود) می‌سازد و عضویت ACTIVE ایجاد می‌کند تا هر دو مسیر تأیید ساختار یکسانی بسازند. خطا هرگز تأیید را نمی‌شکند.
 */
export async function ensureLegacyMembership(db: TenantPrismaClient, profileId: string, productCode: string | null | undefined, tier?: string): Promise<void> {
  if (!productCode || !LEGACY_CODES.has(productCode)) return;
  try {
    const product =
      (await db.agentProduct.findUnique({ where: { code: productCode } })) ??
      (await db.agentProduct.create({ data: { code: productCode, name: LEGACY_PRODUCT_NAMES[productCode]! } }));
    await db.agentProductMembership.upsert({
      where: { resellerProfileId_productId: { resellerProfileId: profileId, productId: product.id } },
      create: { resellerProfileId: profileId, productId: product.id, level: tierToLevel(tier), status: 'ACTIVE', startedAt: new Date() },
      update: {},
    });
  } catch {
    /* ماژول نمایندگی ممکن است در این تننت مهاجرت نشده باشد؛ تأیید درخواست باید ادامه یابد */
  }
}
