import { decryptSecret, encryptSecret, loadSecretsKey, SecretsKeyMissingError } from '../tax/crypto/secret-box.js';

/**
 * رمزگذاری «در حالت سکون» برای رازهای عمومی برنامه (کلید درگاه پرداخت، کلید پنل پیامک، رازهای TOTP).
 * همان AES-256-GCM ماژول مالیات (tax/crypto/secret-box.ts) ولی با کلید جدا: APP_SECRETS_KEY (۳۲ بایت، hex ۶۴ نویسه یا base64).
 *
 * - Fail-closed: بدون کلید معتبر، «نوشتن» رازِ جدید خطا می‌دهد و هرگز متن ساده ذخیره نمی‌شود.
 * - مهاجرت تنبل: مقدار ذخیره‌شده‌ی قدیمی (بدون پیشوند enc1:) هنوز خوانده می‌شود و `legacy: true` برمی‌گردد
 *   تا فراخواننده بتواند آن را رمزشده بازنویسی کند.
 * - AAD = «هدف + شناسه‌ی تننت»، پس بلاک رمزشده‌ی یک تننت/هدف در جای دیگر باز نمی‌شود.
 */
export const APP_SECRETS_ENV = 'APP_SECRETS_KEY';
const PREFIX = 'enc1:';

export class AppSecretsKeyMissingError extends SecretsKeyMissingError {
  constructor() {
    super('کلید رمزنگاری سرور (APP_SECRETS_KEY) تنظیم نشده یا نامعتبر است؛ ذخیره‌ی رازهای جدید ممکن نیست');
  }
}

function key(): Buffer {
  try {
    return loadSecretsKey(process.env[APP_SECRETS_ENV]);
  } catch {
    throw new AppSecretsKeyMissingError();
  }
}

export function isAppSecretsKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export const isSealed = (stored: string | null | undefined): boolean => typeof stored === 'string' && stored.startsWith(PREFIX);

/** رشته‌ی خالی همان خالی می‌ماند (یعنی «تنظیم نشده»). */
export function sealSecret(plain: string, aad: string): string {
  if (!plain) return '';
  return PREFIX + encryptSecret(plain, aad, key());
}

export function openSecret(stored: string | null | undefined, aad: string): { value: string; legacy: boolean } {
  if (!stored) return { value: '', legacy: false };
  if (!isSealed(stored)) return { value: stored, legacy: true };
  return { value: decryptSecret(stored.slice(PREFIX.length), aad, key()), legacy: false };
}

export const gatewayAad = (tenantId: string, field: string) => `gateway:${field}:${tenantId}`;
/** پنل پیامک تننت: getConnection فقط tenantDb دارد (نه tenantId)؛ جداسازی بین تننت‌ها با خودِ DB-per-tenant است. */
export const smsAad = () => 'sms:apiKey';
export const totpAad = (kind: 'admin' | 'user', id: string) => `totp:${kind}:${id}`;
