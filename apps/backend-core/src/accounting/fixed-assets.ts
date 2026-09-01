import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

export const FIXED_ASSET_ACCOUNT = {
  ASSET: '1050',
  ACCUMULATED_DEPRECIATION: '1055',
  DEPRECIATION_EXPENSE: '5040',
};

const EXTRA_ACCOUNTS: Array<{ code: string; name: string; type: 'ASSET' | 'EXPENSE' }> = [
  { code: FIXED_ASSET_ACCOUNT.ASSET, name: 'دارایی‌های ثابت', type: 'ASSET' },
  { code: FIXED_ASSET_ACCOUNT.ACCUMULATED_DEPRECIATION, name: 'استهلاک انباشته', type: 'ASSET' },
  { code: FIXED_ASSET_ACCOUNT.DEPRECIATION_EXPENSE, name: 'هزینه استهلاک', type: 'EXPENSE' },
];

/**
 * ماژول دارایی ثابت دیرتر از کدینگ پایه اضافه شد، پس تننت‌های قبلی این سه
 * کد را در جدول حساب‌ها ندارند — برخلاف ensureDefaultChartOfAccounts که فقط
 * روی جدول کاملاً خالی کار می‌کند، این تابع فقط کدهای گمشده را اضافه می‌کند.
 */
export async function ensureFixedAssetAccounts(db: TenantPrismaClient): Promise<void> {
  const existing = await db.account.findMany({
    where: { code: { in: EXTRA_ACCOUNTS.map((a) => a.code) } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((a) => a.code));
  const missing = EXTRA_ACCOUNTS.filter((a) => !existingCodes.has(a.code));
  if (missing.length === 0) return;
  try {
    await db.account.createMany({ data: missing.map((a) => ({ ...a, isSystem: true })) });
  } catch (err) {
    const isUniqueConstraintViolation =
      typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
    if (!isUniqueConstraintViolation) throw err;
  }
}

export type DepreciationSnapshot = {
  monthlyDepreciation: number;
  monthsElapsed: number;
  accumulatedDepreciation: number;
  bookValue: number;
};

/** استهلاک خط مستقیم — تا سقف (بهای تمام‌شده - ارزش اسقاط)، از تاریخ خرید تا امروز یا تاریخ واگذاری. */
export function computeDepreciation(asset: {
  purchaseDate: Date;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  disposedAt: Date | null;
}): DepreciationSnapshot {
  const depreciableBase = Math.max(0, asset.purchaseCost - asset.salvageValue);
  const monthlyDepreciation = asset.usefulLifeMonths > 0 ? Math.round(depreciableBase / asset.usefulLifeMonths) : 0;
  const asOf = asset.disposedAt ?? new Date();
  const monthsElapsed = Math.max(
    0,
    Math.min(
      asset.usefulLifeMonths,
      (asOf.getFullYear() - asset.purchaseDate.getFullYear()) * 12 + (asOf.getMonth() - asset.purchaseDate.getMonth()),
    ),
  );
  const accumulatedDepreciation = Math.min(depreciableBase, monthlyDepreciation * monthsElapsed);
  return {
    monthlyDepreciation,
    monthsElapsed,
    accumulatedDepreciation,
    bookValue: asset.purchaseCost - accumulatedDepreciation,
  };
}
