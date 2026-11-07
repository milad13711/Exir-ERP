import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { writeLock } from './write-lock.js';

const STALE_HEARTBEAT_MS = 2 * 60_000;
const CACHE_MS = 3_000;
const cache = new WeakMap<object, { at: number; active: boolean }>();

/**
 * آیا برای این تننت تبدیل ارز پایه در جریان است؟ (کرون‌ها و صف‌ها پیش از دست‌زدن به مبالغ می‌پرسند.)
 * حافظه‌ی همین پروسه + ردیف RUNNING با ضربان تازه در دیتابیس (برای پروسه‌ی دیگر)؛ خطای دیتابیس ⇒ false.
 */
export async function isConversionActive(tenantId: string, db: TenantPrismaClient): Promise<boolean> {
  if (writeLock.isLocked(tenantId)) return true;
  if (!db || typeof db !== 'object') return false;
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.active;
  let active = false;
  try {
    active = (await db.baseCurrencyConversion.count({ where: { status: 'RUNNING', heartbeatAt: { gt: new Date(Date.now() - STALE_HEARTBEAT_MS) } } })) > 0;
  } catch {
    active = false;
  }
  cache.set(db, { at: Date.now(), active });
  return active;
}
