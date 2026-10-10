import { createHash } from 'node:crypto';

/**
 * محدودکننده‌ی نرخ درون‌حافظه‌ای (پنجره‌ی ثابت) — بدون وابستگی خارجی. بک‌اند تک‌نمونه است؛
 * اگر روزی چندنمونه شد، کافی است store با Redis جایگزین شود (رابط `hit` ثابت می‌ماند).
 * شمارنده‌های «به ازای شماره» (OTP) عمداً در DB هستند و به این حافظه وابسته نیستند.
 */
export type RateRule = {
  /** نام قانون برای لاگ و کلید شمارنده */
  name: string;
  limit: number;
  windowSec: number;
  /** کلید شمارش */
  by: 'ip' | 'phone' | 'token';
};

export type RouteRuleSet = { match: (method: string, path: string) => boolean; rules: RateRule[] };

type Bucket = { count: number; resetAt: number };

export class RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly maxEntries = 200_000) {}

  /** یک ضربه ثبت می‌کند. allowed=false یعنی سقف رد شد. */
  hit(key: string, limit: number, windowSec: number, now = Date.now()): { allowed: boolean; remaining: number; retryAfterSec: number } {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (!b && this.buckets.size >= this.maxEntries) this.sweep(now);
      b = { count: 0, resetAt: now + windowSec * 1000 };
      this.buckets.set(key, b);
    }
    b.count += 1;
    const allowed = b.count <= limit;
    return { allowed, remaining: Math.max(0, limit - b.count), retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }

  sweep(now = Date.now()): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    // اگر هنوز پر است (حمله‌ی کلید-تصادفی): قدیمی‌ترین‌ها را حذف کن تا حافظه بی‌کران نشود
    if (this.buckets.size >= this.maxEntries) {
      let n = Math.ceil(this.maxEntries * 0.1);
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        if (--n <= 0) break;
      }
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

const OTP_REQUEST = /\/otp\/request\/?$/;
const OTP_VERIFY = /\/otp\/(verify|select-tenant)\/?$/;

/**
 * جدول سیاست مسیرها (ترتیب مهم است؛ اولین تطبیق + قانون عمومی IP). مقادیر عمداً سخاوتمندانه‌اند تا
 * کاربران واقعی پشت NAT مشترک (دفتر/اپراتور موبایل) بسته نشوند؛ سخت‌گیری اصلی OTP «به ازای شماره» در AuthService است.
 */
export function buildRouteRules(): RouteRuleSet[] {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const otpReqIp = n(process.env.RL_OTP_REQUEST_PER_IP_15M, 30);
  const otpVerifyIp = n(process.env.RL_OTP_VERIFY_PER_IP_15M, 60);
  const otpVerifyPhone = n(process.env.RL_OTP_VERIFY_PER_PHONE_15M, 12);
  const adminLoginIp = n(process.env.RL_ADMIN_LOGIN_PER_IP_15M, 20);
  return [
    { match: (m, p) => m === 'POST' && OTP_REQUEST.test(p), rules: [{ name: 'otp-request-ip', limit: otpReqIp, windowSec: 900, by: 'ip' }, { name: 'otp-request-phone', limit: 8, windowSec: 900, by: 'phone' }] },
    { match: (m, p) => m === 'POST' && OTP_VERIFY.test(p), rules: [{ name: 'otp-verify-ip', limit: otpVerifyIp, windowSec: 900, by: 'ip' }, { name: 'otp-verify-phone', limit: otpVerifyPhone, windowSec: 900, by: 'phone' }] },
    { match: (m, p) => (m === 'POST' || m === 'PATCH') && p.startsWith('/api/admin/auth/'), rules: [{ name: 'admin-auth-ip', limit: adminLoginIp, windowSec: 900, by: 'ip' }] },
    { match: (m, p) => m === 'POST' && p.startsWith('/api/auth/'), rules: [{ name: 'auth-ip', limit: 60, windowSec: 900, by: 'ip' }] },
    { match: (m, p) => m === 'POST' && p.startsWith('/api/licenses/check-in'), rules: [{ name: 'license-checkin-ip', limit: 120, windowSec: 3600, by: 'ip' }] },
    { match: (m, p) => m === 'POST' && p.startsWith('/api/security/csp-report'), rules: [{ name: 'csp-report-ip', limit: 60, windowSec: 60, by: 'ip' }] },
    // فرم‌های عمومی سایت که برای تیم ایمیل می‌فرستند (spam/mail-bomb): سقف سخت‌گیرانه
    { match: (m, p) => m === 'POST' && /^\/api\/public\/(reseller-applications|catalog\/(lead|quote))\/?$/.test(p), rules: [{ name: 'site-form-ip', limit: n(process.env.RL_SITE_FORM_PER_IP_HOUR, 10), windowSec: 3600, by: 'ip' }] },
    // ساخت تننت = تخصیص دیتابیس (سنگین): سقف سخت‌گیرانه به‌ازای IP
    { match: (m, p) => m === 'POST' && /^\/api\/public\/signup\/?$/.test(p), rules: [{ name: 'signup-create-ip', limit: n(process.env.RL_SIGNUP_PER_IP_HOUR, 10), windowSec: 3600, by: 'ip' }] },
    // وب‌هوک PBX با راز احراز می‌شود و ممکن است پرحجم باشد
    { match: (_m, p) => p.startsWith('/api/public/voip/'), rules: [{ name: 'voip-webhook-ip', limit: 3000, windowSec: 60, by: 'ip' }] },
    // «پروژه‌های من» در صفحه‌ی پیگیری (نشست OTP): فهرست‌کردن/حدس توکن را کند می‌کند
    { match: (m, p) => m === 'POST' && /^\/api\/public\/tracking\/[^/]+\/(my-)?projects\/?$/.test(p), rules: [{ name: 'tracking-projects-ip', limit: n(process.env.RL_TRACKING_PROJECTS_PER_IP_15M, 60), windowSec: 900, by: 'ip' }] },
    // نوشتن در endpointهای عمومی بدون ورود (ثبت فرم/سفارش/نوبت/... ) — ضد اسپم و SMS-pumping
    { match: (m, p) => m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && p.startsWith('/api/public/'), rules: [{ name: 'public-write-ip', limit: n(process.env.RL_PUBLIC_WRITE_PER_IP_MIN, 120), windowSec: 60, by: 'ip' }] },
    { match: (m, p) => (m === 'GET' || m === 'HEAD') && p.startsWith('/api/public/'), rules: [{ name: 'public-read-ip', limit: n(process.env.RL_PUBLIC_READ_PER_IP_MIN, 600), windowSec: 60, by: 'ip' }] },
  ];
}

export const GENERIC_IP_RULE = (): RateRule => ({ name: 'generic-ip', limit: Number(process.env.RL_GENERIC_PER_IP_MIN) || 3000, windowSec: 60, by: 'ip' });
export const TOKEN_RULE = (): RateRule => ({ name: 'token', limit: Number(process.env.RL_TOKEN_PER_MIN) || 1500, windowSec: 60, by: 'token' });

/** اثر انگشت کوتاه یک توکن برای کلید شمارنده (خود توکن هرگز در حافظه‌ی شمارنده/لاگ نمی‌ماند). */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
