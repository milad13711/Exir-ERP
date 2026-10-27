import { createHash } from 'node:crypto';

/**
 * منطق خالص لایه‌ی Idempotency ماژول «کار آفلاین و همگام‌سازی» — بدون وابستگی به Nest/Prisma تا کامل آزمون‌پذیر باشد.
 * مدل تهدید: کلید را کلاینت می‌سازد (UUID) و ممکن است حدس‌زده یا بین کاربران تکرار شود؛ بنابراین
 *  - دامنه‌ی کلید = (تننت [دیتابیس جدا], کاربر) — کلید کاربر دیگر هرگز دیده/بازپخش نمی‌شود؛
 *  - هر کلید به هش دقیق درخواست (متد+مسیر+کوئری+بدنه) قفل است؛ استفاده‌ی دوباره با درخواست دیگر → ۴۲۲؛
 *  - پاسخ ذخیره‌شده فقط به همان کاربر برمی‌گردد و مجوزها در اجرای اول (گاردهای عادی) بررسی شده‌اند.
 */

export const IDEMPOTENCY_TTL_MS = 7 * 24 * 3600 * 1000;
/** ردیف PENDING قدیمی‌تر از این (کرش/قطع پردازش) قابل تصاحب مجدد است. */
export const PENDING_TIMEOUT_MS = 15 * 60_000;
/** سقف تعداد کلید فعال (۷ روز) برای هر کاربر — ضد انباشت/سوءاستفاده. */
export const MAX_KEYS_PER_USER = 5000;
/** پاسخ بزرگ‌تر از این ذخیره نمی‌شود؛ فقط status + شناسه‌ی منبع. */
export const MAX_STORED_BODY_BYTES = 32 * 1024;
/** سقف مطلق عمر زمان دستگاه (حتی با بازبینی مدیر) */
export const MAX_OFFLINE_AGE_MS = 365 * 24 * 3600 * 1000;
/** اختلاف مجاز زمان دستگاه از آینده (ساعت خراب). */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function parseIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return KEY_RE.test(v) ? v : null;
}

/** JSON پایدار (کلیدهای مرتب) تا ترتیب کلیدهای بدنه روی هش اثر نگذارد. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function hashRequest(method: string, pathWithQuery: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()}\n${pathWithQuery}\n${stableStringify(body)}`).digest('hex');
}

/**
 * زمان دستگاه «ادعای کلاینت» است: نامعتبر → invalid؛ قدیمی‌تر از maxAgeMs → tooOld (رد می‌شود، دیگر null نمی‌شود)؛
 * آینده‌ی دور → به اکنون بریده می‌شود.
 */
export type ClampResult = { ok: true; at: Date } | { ok: false; reason: 'invalid' | 'tooOld' };
export function clampOfflineCreatedAt(raw: unknown, now = Date.now(), maxAgeMs = MAX_OFFLINE_AGE_MS): ClampResult {
  if (typeof raw !== 'string' || raw.length > 40) return { ok: false, reason: 'invalid' };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { ok: false, reason: 'invalid' };
  if (t < now - maxAgeMs) return { ok: false, reason: 'tooOld' };
  if (t > now + MAX_FUTURE_SKEW_MS) return { ok: true, at: new Date(now) };
  return { ok: true, at: new Date(t) };
}

export function sanitizeDevice(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().slice(0, 64);
  return /^[\p{L}\p{N} ._:-]{1,64}$/u.test(v) ? v : null;
}

export type OfflineMeta = { createdAt: Date | null; device: string | null; skewMs: number | null };

/** فراداده‌ی ادعاشده؛ createdAt فقط وقتی معتبر و در بازه باشد پر می‌شود (بررسی سیاست جداگانه در interceptor). */
export function parseOfflineMeta(headers: Record<string, unknown>, now = Date.now(), maxAgeMs = MAX_OFFLINE_AGE_MS): OfflineMeta | null {
  const c = clampOfflineCreatedAt(headers['x-offline-created-at'], now, maxAgeMs);
  const createdAt = c.ok ? c.at : null;
  const device = sanitizeDevice(headers['x-offline-device']);
  if (!createdAt && !device) return null;
  const rawClient = typeof headers['x-client-time'] === 'string' ? Date.parse(headers['x-client-time']) : NaN;
  return { createdAt, device, skewMs: Number.isFinite(rawClient) ? rawClient - now : null };
}

// ── ذخیره‌ی درخواست/پاسخ ─────────────────────────────────────────────────────

export type IdemRecord = {
  id: string;
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  status: 'PENDING' | 'DONE' | 'UNKNOWN';
  responseStatus: number | null;
  responseBody: unknown;
  resourceId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

export type ClaimInput = {
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  offlineCreatedAt: Date | null;
  now: Date;
};

/** لایه‌ی ذخیره‌سازی (در تولید Prisma؛ در آزمون حافظه). claim باید اتمیک و بر پایه‌ی یکتایی (userId,key) باشد. */
export interface IdempotencyStore {
  claim(input: ClaimInput): Promise<{ claimed: true; id: string } | { claimed: false; existing: IdemRecord }>;
  /** شمارش کلیدهای فعال (منقضی‌نشده) یک کاربر */
  countForUser(userId: string, now: Date): Promise<number>;
  /** complete شکست خورد: نتیجه نامشخص — دیگر دوباره اجرا نمی‌شود */
  markUnknown(id: string): Promise<void>;
  complete(id: string, data: { responseStatus: number; responseBody: unknown; resourceId: string | null }): Promise<void>;
  /** حذف ردیف (فقط اگر هنوز PENDING باشد) تا تلاش بعدی دوباره اجرا شود. */
  release(id: string): Promise<void>;
  /** حذف ردیف قدیمی/منقضی که می‌خواهیم تصاحب کنیم (فقط اگر همان نسخه باشد). */
  evict(id: string): Promise<boolean>;
}

export type BeginResult =
  | { kind: 'proceed'; id: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'reused' }
  | { kind: 'in-progress' }
  | { kind: 'unknown' }
  | { kind: 'quota' };

export async function beginIdempotent(store: IdempotencyStore, input: ClaimInput): Promise<BeginResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await store.claim(input);
    if (r.claimed) {
      if ((await store.countForUser(input.userId, input.now)) > MAX_KEYS_PER_USER) {
        await store.release(r.id);
        return { kind: 'quota' };
      }
      return { kind: 'proceed', id: r.id };
    }
    const ex = r.existing;
    // کلید روی درخواست دیگری قفل است (حتی اگر منقضی نشده)
    const expired = ex.expiresAt.getTime() <= input.now.getTime();
    if (expired) {
      await store.evict(ex.id);
      continue;
    }
    if (ex.requestHash !== input.requestHash || ex.method !== input.method) return { kind: 'reused' };
    if (ex.status === 'UNKNOWN') return { kind: 'unknown' };
    if (ex.status === 'DONE' && ex.responseStatus !== null) return { kind: 'replay', status: ex.responseStatus, body: ex.responseBody ?? null };
    // PENDING
    if (input.now.getTime() - ex.createdAt.getTime() > PENDING_TIMEOUT_MS) {
      await store.evict(ex.id);
      continue;
    }
    return { kind: 'in-progress' };
  }
  return { kind: 'in-progress' };
}

/** بدنه‌ی قابل ذخیره: JSON ساده و کوچک؛ وگرنه فقط شناسه. */
export function packResponse(body: unknown, opts: { storeBody?: boolean } = {}): { body: unknown; resourceId: string | null } {
  const id =
    body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { id?: unknown }).id === 'string' && /^[0-9a-zA-Z_-]{1,64}$/.test((body as { id: string }).id)
      ? (body as { id: string }).id
      : null;
  if (opts.storeBody === false) return { body: id ? { id, idempotentReplay: true } : null, resourceId: id };
  if (body === undefined || body === null) return { body: null, resourceId: id };
  if (typeof body !== 'object' && typeof body !== 'string' && typeof body !== 'number' && typeof body !== 'boolean') return { body: null, resourceId: id };
  if (Buffer.isBuffer(body) || (body as object).constructor?.name === 'StreamableFile') return { body: null, resourceId: id };
  let json: string;
  try {
    json = JSON.stringify(body);
  } catch {
    return { body: id ? { id, idempotentReplay: true } : null, resourceId: id };
  }
  if (json === undefined || Buffer.byteLength(json) > MAX_STORED_BODY_BYTES) {
    return { body: id ? { id, idempotentReplay: true, truncated: true } : { idempotentReplay: true, truncated: true }, resourceId: id };
  }
  return { body: JSON.parse(json), resourceId: id };
}
