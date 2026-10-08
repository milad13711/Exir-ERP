import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * آیا همتای TCP یک پروکسی قابل‌اعتماد است؟ nginx روی همان میزبان (loopback) یا شبکه‌ی داخلی docker/خصوصی.
 * اگر بک‌اند مستقیم از اینترنت در دسترس باشد، X-Real-IP/X-Forwarded-For جعلی هرگز پذیرفته نمی‌شود.
 */
export function isTrustedProxyAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  if (a === '::1' || a === 'localhost') return true;
  if (isIP(a) === 4) {
    const [p, q] = a.split('.').map(Number);
    return p === 127 || p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168);
  }
  const lower = a.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd'); // IPv6 ULA
}

function firstValid(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  const first = raw?.split(',')[0]?.trim();
  return first && isIP(first.replace(/^::ffff:/i, '')) ? first.replace(/^::ffff:/i, '') : undefined;
}

/** IP واقعی کلاینت: X-Real-IP (که nginx ست می‌کند) فقط وقتی درخواست از یک پروکسی قابل‌اعتماد آمده باشد. */
export function clientIp(req: Pick<Request, 'headers' | 'socket'>): string {
  const peer = req.socket?.remoteAddress;
  if (isTrustedProxyAddress(peer)) {
    const real = firstValid(req.headers['x-real-ip']);
    if (real) return real;
    const fwd = firstValid(req.headers['x-forwarded-for']);
    if (fwd) return fwd;
  }
  return (peer ?? 'unknown').replace(/^::ffff:/i, '');
}

/**
 * فراخوانی داخلی سرور-به-سرور (مثلاً SSR وب‌پنل → بک‌اند روی شبکه‌ی docker): همتای TCP خصوصی است و هدر X-Real-IP/X-Forwarded-For ندارد
 * (nginx برای ترافیک اینترنتی همیشه یکی از آن‌ها را ست می‌کند). چنین فراخوانی‌ای مشمول سقف‌های «به ازای IP» نیست،
 * وگرنه همه‌ی کاربران SSR یک IP مشترک حساب می‌شدند.
 */
export function isInternalCall(req: Pick<Request, 'headers' | 'socket'>): boolean {
  return isTrustedProxyAddress(req.socket?.remoteAddress) && !firstValid(req.headers['x-real-ip']) && !firstValid(req.headers['x-forwarded-for']);
}
