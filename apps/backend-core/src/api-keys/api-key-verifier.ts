import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { API_KEY_LOOKUP_PREFIX_LENGTH } from './api-key.constants.js';

/**
 * بررسی کلید API. کلید خام ۱۲۸ بیت تصادفی است و فقط bcrypt آن ذخیره می‌شود. bcrypt (جاوااسکریپت خالص، cost 10) برای
 * هر درخواست API ~۶۰ms CPU می‌خورد — هم کند است و هم بردار DoS. پس نتیجه‌ی موفق ۳۰ ثانیه در حافظه نگه داشته می‌شود
 * (کلید کش = SHA-256 توکن؛ خود توکن نگه داشته نمی‌شود) و هنگام ابطال کش پاک می‌شود.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { id: string; tenantId: string; exp: number }>();

export function invalidateApiKeyCache(): void {
  cache.clear();
}

export async function verifyApiKeyToken(controlDb: Pick<ControlPrismaService, 'apiKey'>, token: string): Promise<{ id: string; tenantId: string } | null> {
  const fp = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const hit = cache.get(fp);
  if (hit && hit.exp > now) return { id: hit.id, tenantId: hit.tenantId };
  cache.delete(fp);

  const prefix = token.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
  const candidates = await controlDb.apiKey.findMany({ where: { keyPrefix: prefix, revokedAt: null } });
  for (const candidate of candidates) {
    if (await bcrypt.compare(token, candidate.keyHash)) {
      void controlDb.apiKey.update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(fp, { id: candidate.id, tenantId: candidate.tenantId, exp: now + TTL_MS });
      return { id: candidate.id, tenantId: candidate.tenantId };
    }
  }
  return null;
}
