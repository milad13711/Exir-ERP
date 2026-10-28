import type { PrismaClient as TenantPrismaClient } from '../../../generated/tenant-client/index.js';
import { DEFAULT_FISCAL_START_MONTH, normalizeStartMonth } from './jalali-periods.js';

const KEY = { moduleCode: 'accounting', key: 'fiscal' } as const;

export async function getFiscalStartMonth(db: Pick<TenantPrismaClient, 'moduleSetting'>): Promise<number> {
  const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: KEY } });
  const v = (row?.value as { startMonth?: number } | null)?.startMonth;
  return v == null ? DEFAULT_FISCAL_START_MONTH : normalizeStartMonth(v);
}

export async function setFiscalStartMonth(db: Pick<TenantPrismaClient, 'moduleSetting'>, startMonth: number): Promise<number> {
  const value = { startMonth: normalizeStartMonth(startMonth) };
  await db.moduleSetting.upsert({ where: { moduleCode_key: KEY }, update: { value }, create: { ...KEY, value } });
  return value.startMonth;
}
