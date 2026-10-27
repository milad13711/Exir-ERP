/**
 * رمزنگاری داده‌ی ماندگار آفلاین: AES-GCM 256 با کلید «غیرقابل‌استخراج» (non-extractable) که خودِ CryptoKey در IndexedDB
 * ذخیره می‌شود (ساختار clone؛ مواد خام کلید به JS داده نمی‌شود). به ازای هر (تننت، کاربر) یک کلید.
 * هر رکورد با IV تصادفی ۱۲ بایتی و AAD = «scope|نوع|شناسه» رمز می‌شود؛ جابجایی ciphertext بین رکوردها/کاربران رمزگشایی نمی‌شود.
 * حذف کلید (crypto-shredding) = تمام داده‌ی آن کاربر روی دستگاه بلافاصله بی‌مصرف است.
 * محدودیت صادقانه: این دفاعِ لایه‌ای در برابر خواندن عادیِ دیسک/پروفایل است، نه در برابر XSS یا بدافزار هم‌سطح کاربر.
 */

export async function generateDataKey(c: Crypto = globalThis.crypto): Promise<CryptoKey> {
  return c.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export type Sealed = { iv: Uint8Array; ct: ArrayBuffer };

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sealBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array, aad: string, c: Crypto = globalThis.crypto): Promise<Sealed> {
  const iv = c.getRandomValues(new Uint8Array(12));
  const ct = await c.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, data as BufferSource);
  return { iv, ct };
}

export async function openBytes(key: CryptoKey, sealed: Sealed, aad: string, c: Crypto = globalThis.crypto): Promise<ArrayBuffer> {
  return c.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, sealed.ct);
}

export async function sealJson(key: CryptoKey, value: unknown, aad: string, c?: Crypto): Promise<Sealed> {
  return sealBytes(key, enc.encode(JSON.stringify(value)), aad, c);
}

export async function openJson<T>(key: CryptoKey, sealed: Sealed, aad: string, c?: Crypto): Promise<T> {
  return JSON.parse(dec.decode(await openBytes(key, sealed, aad, c))) as T;
}
