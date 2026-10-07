/**
 * قواعد مبداهای مجاز (CORS) برای ارسال فرم از سایت‌های دیگر.
 * - لیست خالی = فرم عمومی برای همه‌ی سایت‌ها (`*`)؛ هرگز با credentials (کوکی) همراه نیست.
 * - درخواست بدون هدر Origin (سرور به سرور: Zapier، curl، وردپرس سمت سرور) محدود نمی‌شود؛
 *   محدودیت مبدأ فقط یک کنترل سطح مرورگر است، نه احراز هویت.
 */

/** «https://Example.com/path?x» → «https://example.com»؛ نامعتبر یا غیر http(s) → null. */
export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** لیست ورودی کاربر → مبداهای یکتا و معتبر (حداکثر ۲۰). */
export function normalizeOrigins(list: string[] | undefined): string[] {
  if (!list) return [];
  const out = new Set<string>();
  for (const raw of list) {
    const o = normalizeOrigin(raw);
    if (o) out.add(o);
  }
  return [...out].slice(0, 20);
}

export type CorsDecision =
  | { allowed: true; allowOrigin: string; vary: boolean }
  | { allowed: false };

export function decideCors(allowedOrigins: string[], requestOrigin: string | undefined): CorsDecision {
  if (allowedOrigins.length === 0) return { allowed: true, allowOrigin: '*', vary: false };
  if (!requestOrigin) return { allowed: true, allowOrigin: '', vary: true }; // سرور به سرور — هدر CORS لازم نیست
  const origin = normalizeOrigin(requestOrigin);
  if (origin && allowedOrigins.includes(origin)) return { allowed: true, allowOrigin: origin, vary: true };
  return { allowed: false };
}
