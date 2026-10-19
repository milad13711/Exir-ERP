import { effectiveStatus } from './license-key.js';
import type { SigningKey } from './license-crypto.js';
import { buildActivationToken } from './license-token-builder.js';

export class OfflineTokenError extends Error {}

export const INSTALLATION_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
export const MAX_OFFLINE_DAYS = 1100;

/** حداقل رابط DB لازم (Prisma client یا tx). */
type Db = {
  $transaction: <T>(cb: (tx: any) => Promise<T>) => Promise<T>;
  license: { findFirst: (a: any) => Promise<any> };
};

/**
 * منطق واحد صدور توکن آفلاین — هم سرویس ادمین و هم CLI از همین مسیر می‌گذرند:
 * اعتبارسنجی installationId و سقف روز، فقط لایسنس فعال، و مصرف ظرفیت فعال‌سازی اتمیک (قفل ردیف).
 */
export async function issueOfflineTokenCore(
  db: Db,
  key: SigningKey,
  p: { licenseId?: string; licenseKey?: string; installationId: string; validityDays: number; crlVersion: number },
): Promise<{ token: string; payload: ReturnType<typeof buildActivationToken>['payload'] }> {
  if (!INSTALLATION_ID_RE.test(p.installationId)) throw new OfflineTokenError('شناسه‌ی نصب نامعتبر است');
  if (!Number.isInteger(p.validityDays) || p.validityDays < 1 || p.validityDays > MAX_OFFLINE_DAYS) {
    throw new OfflineTokenError(`اعتبار توکن باید بین ۱ تا ${MAX_OFFLINE_DAYS} روز باشد`);
  }
  const identifier = p.installationId.toLowerCase();
  return db.$transaction(async (tx) => {
    const where = p.licenseId ? { id: p.licenseId, deletedAt: null } : { licenseKey: p.licenseKey, deletedAt: null };
    const probe = await tx.license.findFirst({ where });
    if (!probe) throw new OfflineTokenError('لایسنس یافت نشد');
    await tx.$queryRaw`SELECT "id" FROM "licenses" WHERE "id" = ${probe.id} FOR UPDATE`;
    const lic = await tx.license.findFirst({ where: { id: probe.id, deletedAt: null } });
    if (!lic || !lic.licenseKey) throw new OfflineTokenError('لایسنس یافت نشد');
    if (effectiveStatus(lic) !== 'active') throw new OfflineTokenError('فقط برای لایسنس فعال می‌توان توکن آفلاین صادر کرد');
    const existing = await tx.licenseActivation.findFirst({ where: { licenseId: lic.id, identifier, deletedAt: null } });
    if (!existing) {
      const count = await tx.licenseActivation.count({ where: { licenseId: lic.id, deletedAt: null } });
      if (lic.maxActivations > 0 && count >= lic.maxActivations) throw new OfflineTokenError('سقف فعال‌سازی پر است — ابتدا یک فعال‌سازی را آزاد کنید');
      await tx.licenseActivation.create({ data: { licenseId: lic.id, identifier, ip: null, lastTokenAt: new Date() } });
    }
    return buildActivationToken(key, {
      license: lic,
      installationId: identifier,
      fingerprint: null,
      nonce: null,
      validityDays: p.validityDays,
      crlVersion: p.crlVersion,
    });
  });
}
