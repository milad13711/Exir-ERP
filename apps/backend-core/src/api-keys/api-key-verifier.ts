import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { API_KEY_LOOKUP_PREFIX_LENGTH } from './api-key.constants.js';

/**
 * بررسی کلید API. کلید خام ۱۲۸ بیت تصادفی است و فقط bcrypt آن ذخیره می‌شود (هرگز متن خام). bcrypt (جاوااسکریپت خالص، cost 10) برای
 * هر درخواست API ~۶۰ms CPU می‌خورد — هم کند است و هم بردار DoS. پس نتیجه‌ی موفق ۳۰ ثانیه در حافظه نگه داشته می‌شود
 * (کلید کش = SHA-256 توکن؛ خود توکن نگه داشته نمی‌شود) و هنگام ابطال/چرخش کش پاک می‌شود.
 * انقضا در هر درخواست (حتی ضربه‌ی کش) دوباره بررسی می‌شود؛ بنابراین کلید منقضی حداکثر ۳۰ ثانیه هم زنده نمی‌ماند.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;

export type VerifiedApiKey = {
  id: string;
  tenantId: string;
  /** خالی = کلید قدیمی با دسترسی کامل */
  scopes: string[];
  ipAllowlist: string[];
  expiresAt: Date | null;
};

const cache = new Map<string, { key: VerifiedApiKey; exp: number }>();

export function invalidateApiKeyCache(): void {
  cache.clear();
}

const isExpired = (k: Pick<VerifiedApiKey, 'expiresAt'>, now: number): boolean => !!k.expiresAt && k.expiresAt.getTime() <= now;

export async function verifyApiKeyToken(controlDb: Pick<ControlPrismaService, 'apiKey'>, token: string): Promise<VerifiedApiKey | null> {
  const fp = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const hit = cache.get(fp);
  if (hit && hit.exp > now) return isExpired(hit.key, now) ? null : hit.key;
  cache.delete(fp);

  const prefix = token.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
  const candidates = await controlDb.apiKey.findMany({ where: { keyPrefix: prefix, revokedAt: null } });
  for (const candidate of candidates) {
    if (await bcrypt.compare(token, candidate.keyHash)) {
      const key: VerifiedApiKey = {
        id: candidate.id,
        tenantId: candidate.tenantId,
        scopes: candidate.scopes ?? [],
        ipAllowlist: candidate.ipAllowlist ?? [],
        expiresAt: candidate.expiresAt ?? null,
      };
      if (isExpired(key, now)) return null;
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(fp, { key, exp: now + TTL_MS });
      return key;
    }
  }
  return null;
}

// ── ثبت مصرف (lastUsedAt / lastUsedIp / useCount) — ارزان و دسته‌ای ────────────────
// هر درخواست فقط یک شمارنده‌ی درون‌حافظه را بالا می‌برد؛ هر ۶۰ ثانیه یک‌بار برای هر کلید یک UPDATE می‌خورد.
const FLUSH_MS = 60_000;
const usage = new Map<string, { count: number; ip: string | null; at: Date }>();
let usageDb: Pick<ControlPrismaService, 'apiKey'> | null = null;
let usageTimer: ReturnType<typeof setInterval> | null = null;

export function recordApiKeyUse(controlDb: Pick<ControlPrismaService, 'apiKey'>, keyId: string, ip: string | null): void {
  usageDb = controlDb;
  const cur = usage.get(keyId);
  usage.set(keyId, { count: (cur?.count ?? 0) + 1, ip: ip ?? cur?.ip ?? null, at: new Date() });
  if (!usageTimer) {
    usageTimer = setInterval(() => void flushApiKeyUsage(), FLUSH_MS);
    usageTimer.unref?.();
  }
}

export async function flushApiKeyUsage(): Promise<void> {
  if (!usageDb || usage.size === 0) return;
  const db = usageDb;
  const batch = [...usage.entries()];
  usage.clear();
  await Promise.all(
    batch.map(([id, u]) =>
      db.apiKey
        .update({ where: { id }, data: { lastUsedAt: u.at, lastUsedIp: u.ip, useCount: { increment: u.count } } })
        .catch(() => undefined),
    ),
  );
}
