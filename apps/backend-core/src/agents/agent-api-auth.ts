/**
 * احراز هویت API ورودی محصولات: کلید Bearer (فقط هش SHA-256 ذخیره می‌شود؛ کلید ≥۲۴۰ بیت تصادفی است پس bcrypt لازم نیست)،
 * امضای HMAC-SHA256 روی «timestamp.rawBody» با رمز امضای جدا، پنجره‌ی زمانی ۵ دقیقه، محدودکننده‌ی نرخ به‌ازای کلید.
 * همه‌ی مقایسه‌ها constant-time هستند. بدون وابستگی به Nest/Prisma — کاملاً تست‌پذیر.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AGENT_KEY_PREFIX, AGENT_SIGN_PREFIX } from './agent-constants.js';

export const TIMESTAMP_WINDOW_SEC = 300;

export type GeneratedAgentKey = { key: string; keyPrefix: string; keyHash: string; signingSecret: string };

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateAgentKey(): GeneratedAgentKey {
  const key = AGENT_KEY_PREFIX + randomBytes(32).toString('base64url');
  const signingSecret = AGENT_SIGN_PREFIX + randomBytes(32).toString('base64url');
  return { key, keyPrefix: key.slice(0, AGENT_KEY_PREFIX.length + 6), keyHash: hashAgentKey(key), signingSecret };
}

/** نمایش مخفی‌شده‌ی کلید (بعد از ساخت هرگز کامل نمایش داده نمی‌شود). */
export function maskAgentKey(keyPrefix: string): string {
  return `${keyPrefix}••••••••••••••••`;
}

/** هدر Authorization: Bearer exir_agent_… → کلید یا null (قالب نامعتبر پیش از هر کوئری DB رد می‌شود). */
export function parseBearerKey(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h || !h.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  if (!token.startsWith(AGENT_KEY_PREFIX) || token.length < AGENT_KEY_PREFIX.length + 32 || token.length > 200) return null;
  if (!/^[A-Za-z0-9_\-]+$/.test(token)) return null;
  return token;
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba); // زمان تقریباً ثابت حتی برای طول نابرابر
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function computeSignature(signingSecret: string, timestamp: string, rawBody: string | Buffer): string {
  const h = createHmac('sha256', signingSecret);
  h.update(`${timestamp}.`);
  h.update(rawBody);
  return h.digest('hex');
}

export type SignatureCheck = { ok: true } | { ok: false; code: 'MISSING_SIGNATURE' | 'BAD_TIMESTAMP' | 'TIMESTAMP_OUT_OF_WINDOW' | 'BAD_SIGNATURE' };

/** timestamp: ثانیه‌ی یونیکس (عدد صحیح). امضا: hex (با پیشوند اختیاری sha256=). */
export function verifySignature(opts: { signingSecret: string; timestamp: string | undefined; signature: string | undefined; rawBody: string | Buffer; nowMs?: number }): SignatureCheck {
  const { timestamp, signature } = opts;
  if (!timestamp || !signature) return { ok: false, code: 'MISSING_SIGNATURE' };
  if (!/^\d{9,13}$/.test(timestamp)) return { ok: false, code: 'BAD_TIMESTAMP' };
  let ts = Number(timestamp);
  if (timestamp.length >= 12) ts = Math.floor(ts / 1000); // میلی‌ثانیه هم پذیرفته می‌شود
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_SEC) return { ok: false, code: 'TIMESTAMP_OUT_OF_WINDOW' };
  const provided = signature.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return { ok: false, code: 'BAD_SIGNATURE' };
  const expected = computeSignature(opts.signingSecret, timestamp, opts.rawBody);
  return safeEqualHex(expected, provided) ? { ok: true } : { ok: false, code: 'BAD_SIGNATURE' };
}

/** پنجره‌ی لغزان درون‌حافظه (به‌ازای کلید). در چندپروسه‌ای سقف هر پروسه جداست — حفاظت اصلی در برابر انفجار درخواست است نه سهمیه‌ی دقیق. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly windowMs = 60_000, private readonly maxKeys = 10_000) {}

  /** true = مجاز (و ثبت می‌شود)؛ false = از سقف گذشته. */
  allow(id: string, limit: number, now = Date.now()): boolean {
    const arr = (this.hits.get(id) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= limit) {
      this.hits.set(id, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(id, arr);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return true;
  }

  retryAfterSec(id: string, now = Date.now()): number {
    const arr = this.hits.get(id) ?? [];
    return arr.length ? Math.max(1, Math.ceil((arr[0]! + this.windowMs - now) / 1000)) : 1;
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}
