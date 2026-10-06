import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * رمزگذاری «در حالت سکون» برای رازهای ماژول مالیات (کلید خصوصی RSA).
 * AES-256-GCM با کلید سرور از متغیر محیطی TAX_SECRETS_KEY (۳۲ بایت، hex ۶۴ نویسه یا base64).
 * Fail-closed: اگر کلید تنظیم نشده یا معتبر نباشد، ذخیره/خواندن کلید خصوصی خطا می‌دهد و هرگز متن ساده ذخیره نمی‌شود.
 * AAD شامل «هدف + شناسه‌ی تننت» است تا بلاک رمزشده‌ی یک تننت در تننت دیگر باز نشود.
 * قالب: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
export class SecretsKeyMissingError extends Error {
  constructor(message = 'کلید رمزنگاری سرور (TAX_SECRETS_KEY) تنظیم نشده یا نامعتبر است؛ ذخیره‌ی کلید خصوصی ممکن نیست') {
    super(message);
    this.name = 'SecretsKeyMissingError';
  }
}

export function loadSecretsKey(raw: string | undefined = process.env.TAX_SECRETS_KEY): Buffer {
  const v = raw?.trim();
  if (!v) throw new SecretsKeyMissingError();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) key = Buffer.from(v, 'hex');
  else {
    try {
      const b = Buffer.from(v, 'base64');
      if (b.length === 32) key = b;
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) throw new SecretsKeyMissingError();
  return key;
}

export function encryptSecret(plain: string, aad: string, key: Buffer = loadSecretsKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(blob: string, aad: string, key: Buffer = loadSecretsKey()): string {
  const [ver, iv, tag, ct] = blob.split(':');
  if (ver !== 'v1' || !iv || !tag || !ct) throw new Error('قالب رمز ذخیره‌شده نامعتبر است');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

export const privateKeyAad = (tenantId: string) => `tax:privateKey:${tenantId}`;
