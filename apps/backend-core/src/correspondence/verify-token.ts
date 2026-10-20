import { createHash, createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { APP_SECRETS_ENV } from '../security/app-secrets.js';
import { loadSecretsKey } from '../tax/crypto/secret-box.js';

/**
 * توکن صحت‌سنجی عمومی (QR): HMAC-SHA256 قطعی از (tenantId, letterId) با کلید مشتق‌شده از کلید اسرار برنامه.
 * قطعی بودن یعنی چاپ مجدد برگه/PDF همان QR را می‌سازد بی‌آنکه خود توکن ذخیره شود؛ در دیتابیس فقط هش SHA-256 آن
 * (با ایندکس یکتا) است. ۲۵۶ بیت آنتروپی، غیرقابل‌حدس و بدون شمارش‌پذیری.
 */
function key(): Buffer {
  try {
    const k = loadSecretsKey(process.env[APP_SECRETS_ENV]);
    return createHmac('sha256', k).update('correspondence-verify:v1').digest();
  } catch {
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('کلید اسرار برنامه تنظیم نشده است');
    return Buffer.from('dev-only-correspondence-verify-key');
  }
}

export function deriveVerifyToken(tenantId: string, letterId: string): string {
  return createHmac('sha256', key()).update(`${tenantId}:${letterId}`).digest('base64url');
}

export function hashVerifyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** توکن‌های معتبر دقیقاً ۴۳ نویسه‌ی base64url هستند؛ بقیه بی‌درنگ رد می‌شوند. */
export const isWellFormedToken = (t: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(t);
