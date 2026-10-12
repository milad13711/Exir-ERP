import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { normalizeSettings } from './messenger-policy.js';

const BATCH = 500;

/**
 * پاکسازی رسانه‌های منقضی‌شده: بایت‌ها (messenger_media_blobs) با DELETE ارزان حذف می‌شوند و ردیف متادیتا با purgedAt
 * می‌ماند تا پیام «فایل منقضی شد» نشان دهد. تعداد رسانه‌ی پاک‌شده را برمی‌گرداند. idempotent و بدون اثر روی پیام‌ها.
 */
export async function purgeExpiredMedia(db: TenantPrismaClient, now = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await db.messengerMedia.findMany({ where: { purgedAt: null, expiresAt: { lte: now } }, select: { id: true }, take: BATCH });
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    await db.messengerMediaBlob.deleteMany({ where: { mediaId: { in: ids } } });
    await db.messengerMedia.updateMany({ where: { id: { in: ids } }, data: { purgedAt: now } });
    total += ids.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

/** نگه‌داری اختیاری متن: پیام‌های قدیمی‌تر از N روز حذف می‌شوند (واکنش/سنجاق/مخفی‌سازی با cascade). */
export async function purgeOldText(db: TenantPrismaClient, days: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const r = await db.messengerMessage.deleteMany({ where: { createdAt: { lt: cutoff }, kind: { not: 'SYSTEM' } } });
  return r.count;
}

export async function getSettingsRetention(db: TenantPrismaClient): Promise<number | null> {
  const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'messenger', key: 'settings' } } });
  return normalizeSettings(row?.value).retentionDays;
}
