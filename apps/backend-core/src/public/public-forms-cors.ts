import type { NextFunction, Request, Response } from 'express';

/**
 * CORS اختصاصی endpointهای عمومی فرم‌ساز (`/api/public/forms/*`) — برای فراخوانی از سایت‌های دیگر
 * (وردپرس، سایت دست‌نویس، Zapier...). برخلاف CORS سراسری برنامه:
 *  - مبدأ `*` و هرگز `credentials` (کوکی/توکن در این مسیرها اصلاً استفاده نمی‌شود)؛
 *  - محدودیت مبدأ هر فرم (Form.allowedOrigins) داخل کنترلر و بر اساس خود فرم اعمال می‌شود؛
 *  - اندازه‌ی بدنه‌ی POST اینجا و پیش از پارس‌شدن JSON محدود می‌شود (به‌جای سقف ۲۰MB سراسری).
 */
export const PUBLIC_FORMS_PATH_PREFIX = '/api/public/forms/';
export const MAX_PUBLIC_FORM_BODY_BYTES = 256 * 1024;

export function isPublicFormsPath(url: string | undefined): boolean {
  return !!url && url.startsWith(PUBLIC_FORMS_PATH_PREFIX);
}

export function publicFormsCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isPublicFormsPath(req.url)) return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method === 'POST') {
    const header = req.headers['content-length'];
    // بدنه‌ی chunked (بدون Content-Length) نمی‌تواند پیش از پارس‌شدن سنجیده شود → رد می‌شود
    if (header === undefined && req.headers['transfer-encoding']) {
      res.statusCode = 411;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ statusCode: 411, message: 'Content-Length الزامی است' }));
      return;
    }
    if (Number(header ?? 0) > MAX_PUBLIC_FORM_BODY_BYTES) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ statusCode: 413, message: 'حجم درخواست بیش از حد مجاز است' }));
      return;
    }
  }
  next();
}

/** گزینه‌های cors سراسری: روی مسیرهای عمومی فرم هیچ هدر CORS/credentials اضافه نمی‌کند (قبلاً توسط میدلور بالا تنظیم شده). */
export function globalCorsDelegate(allowedOrigins: string[]) {
  return (req: { url?: string }, cb: (err: Error | null, options: Record<string, unknown>) => void) => {
    if (isPublicFormsPath(req.url)) return cb(null, { origin: false, credentials: false });
    cb(null, { origin: allowedOrigins, credentials: true });
  };
}
