import { isIP } from 'node:net';

/**
 * ضد حدس‌زدن کلید برای API عمومی لایسنس: سقف نرخ + قفل کوتاه با backoff نمایی، به ازای IP.
 * - IPv6 روی پیشوند /64 شمرده می‌شود (مهاجم با یک بلوک /64 هزاران IP ندارد).
 * - قفل حداکثر ۱۵ دقیقه (قابل‌تنظیم) تا پشت CGNAT مشتریان بی‌گناه ساعت‌ها قفل نشوند؛ و نصب‌هایی که اخیراً از همین IP با
 *   «شناسه‌ی نصب» معتبر موفق شده‌اند (trusted) از قفل (نه از سقف نرخ) معاف‌اند.
 * - جدول‌ها اندازه‌ی سخت دارند (حذف قدیمی‌ترین‌ها)، پس حافظه با IPهای تصادفی بی‌کران نمی‌شود.
 * (درون‌حافظه‌ای؛ بک‌اند تک‌نمونه است.) قفل «به ازای کلید» عمداً نیست چون مهاجم می‌تواند کلید قربانی را قفل کند.
 */
export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterSec: number; reason: 'rate' | 'locked' };

type Fail = { count: number; windowStart: number; lockLevel: number; lockedUntil: number };

export function throttleKey(ip: string): string {
  const v = ip.replace(/^::ffff:/i, '');
  if (isIP(v) === 6) {
    const groups = expandV6(v);
    return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return v;
}

function expandV6(v: string): string[] {
  const [head, tail] = v.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...fill, ...t].map((g) => g.toLowerCase().padStart(4, '0'));
}

function setCapped<K, V>(m: Map<K, V>, k: K, v: V, max: number): void {
  if (!m.has(k) && m.size >= max) {
    // Map به ترتیب درج نگه می‌دارد → قدیمی‌ترین ۱۰٪ حذف
    let n = Math.ceil(max * 0.1);
    for (const key of m.keys()) {
      m.delete(key);
      if (--n <= 0) break;
    }
  }
  m.set(k, v);
}

export class LicenseThrottle {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly fails = new Map<string, Fail>();
  private readonly trusted = new Map<string, number>();

  constructor(
    private readonly opts = {
      perMinute: 60,
      maxFailures: 12,
      failWindowMs: 15 * 60_000,
      baseLockMs: 60_000,
      maxLockMs: 15 * 60_000,
      trustedMs: 24 * 3600_000,
      maxEntries: 50_000,
    },
  ) {}

  /** trustedId: شناسه‌ی نصب نرمال‌شده‌ی درخواست (اگر قبلاً از همین IP موفق بوده، قفل را دور می‌زند). */
  check(ipRaw: string, now = Date.now(), trustedId?: string): ThrottleVerdict {
    const ip = throttleKey(ipRaw);
    const f = this.fails.get(ip);
    const isTrusted = !!trustedId && (this.trusted.get(`${ip}|${trustedId}`) ?? 0) > now;
    if (f && f.lockedUntil > now && !isTrusted) return { allowed: false, reason: 'locked', retryAfterSec: Math.ceil((f.lockedUntil - now) / 1000) };
    let h = this.hits.get(ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + 60_000 };
      setCapped(this.hits, ip, h, this.opts.maxEntries);
    }
    h.count += 1;
    if (h.count > this.opts.perMinute) {
      return { allowed: false, reason: 'rate', retryAfterSec: Math.max(1, Math.ceil((h.resetAt - now) / 1000)) };
    }
    return { allowed: true };
  }

  recordFailure(ipRaw: string, now = Date.now()): void {
    const ip = throttleKey(ipRaw);
    let f = this.fails.get(ip);
    if (!f || (f.lockedUntil <= now && now - f.windowStart > this.opts.failWindowMs)) {
      f = { count: 0, windowStart: now, lockLevel: f?.lockLevel ?? 0, lockedUntil: 0 };
      setCapped(this.fails, ip, f, this.opts.maxEntries);
    }
    f.count += 1;
    if (f.count >= this.opts.maxFailures) {
      const ms = Math.min(this.opts.maxLockMs, this.opts.baseLockMs * 2 ** f.lockLevel);
      f.lockedUntil = now + ms;
      f.lockLevel += 1;
      f.count = 0;
      f.windowStart = now;
    }
  }

  recordSuccess(ipRaw: string, trustedId?: string, now = Date.now()): void {
    const ip = throttleKey(ipRaw);
    if (trustedId) setCapped(this.trusted, `${ip}|${trustedId}`, now + this.opts.trustedMs, this.opts.maxEntries);
    const f = this.fails.get(ip);
    if (!f) return;
    f.count = 0;
    f.lockLevel = Math.max(0, f.lockLevel - 1);
  }
}

/** پاسخ‌های not_found/نامعتبر باید زمان یکسان داشته باشند (timing oracle). */
export async function equalizeTiming(startedAt: number, minMs = 150, jitterMs = 40): Promise<void> {
  const target = minMs + Math.floor(Math.random() * jitterMs);
  const left = target - (Date.now() - startedAt);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}
