import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * هدرهای امنیتی API (معادل helmet، بدون وابستگی) + شناسه‌ی درخواست.
 * API فقط JSON برمی‌گرداند (و چند صفحه‌ی HTML کوتاه بازگشت از درگاه پرداخت)، پس CSP سخت‌گیر و frame-deny مناسب است.
 * استثنا: Swagger UI (/api/docs) اسکریپت/استایل inline دارد → CSP آن مسیر برداشته می‌شود.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // API را وب‌سایت‌های دیگر (CORS مجاز) می‌خوانند
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.removeHeader('X-Powered-By');
  if (!req.url.startsWith('/api/docs')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  }
  // HSTS فقط وقتی پشت HTTPS هستیم (nginx/CDN هدر X-Forwarded-Proto می‌گذارد) — روی HTTP ساده بی‌اثر و بی‌ضرر است
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // پاسخ‌های API حاوی داده‌ی شخصی‌اند: کش مرورگر/CDN مشترک ممنوع (مسیرهای عمومی خودشان Cache-Control می‌گذارند)
  if (!res.getHeader('Cache-Control') && req.method !== 'GET') res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * سقف حجم بدنه برای مسیرهای بدون ورود پیش از پارس JSON (سقف سراسری ۲۰MB برای پنل‌های واردشده می‌ماند چون
 * عکس‌ها base64 داخل JSON می‌آیند). /api/auth و /api/admin/auth همیشه کوچک‌اند؛ /api/public مثلاً امضا/رزومه‌ی تصویری
 * ممکن است چند MB باشد → ۸MB.
 */
export function publicBodyLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const url = req.url;
  let max = 0;
  if (url.startsWith('/api/auth/') || url.startsWith('/api/admin/auth/')) max = 16 * 1024;
  else if (url.startsWith('/api/public/') && !url.startsWith('/api/public/forms/')) max = Number(process.env.PUBLIC_BODY_LIMIT_BYTES) || 8 * 1024 * 1024;
  if (!max) return next();
  const len = req.headers['content-length'];
  const chunked = len === undefined && !!req.headers['transfer-encoding'];
  if (chunked || Number(len ?? 0) > max) {
    res.statusCode = chunked ? 411 : 413;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ statusCode: res.statusCode, message: chunked ? 'Content-Length الزامی است' : 'حجم درخواست بیش از حد مجاز است' }));
    return;
  }
  next();
}
