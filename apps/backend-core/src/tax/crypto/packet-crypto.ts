import { createCipheriv, createDecipheriv, createHash, createSign, createVerify, constants, randomBytes, publicEncrypt, privateDecrypt, type KeyObject } from 'node:crypto';
import { SYMMETRIC_KEY_WRAP_ENCODING, XOR_MODE } from '../mapping/moodian-field-map.js';
import { normalizeJson } from './normalize.js';

/** امضای RSA-SHA256 (PKCS#1 v1.5) روی رشته‌ی UTF-8، خروجی base64 — پیوست ۱-۳. */
export function signString(text: string, privateKey: KeyObject): string {
  const s = createSign('RSA-SHA256');
  s.update(Buffer.from(text, 'utf8'));
  s.end();
  return s.sign(privateKey).toString('base64');
}

export function verifyString(text: string, signatureB64: string, publicKey: KeyObject): boolean {
  const v = createVerify('RSA-SHA256');
  v.update(Buffer.from(text, 'utf8'));
  v.end();
  return v.verify(publicKey, Buffer.from(signatureB64, 'base64'));
}

/** XOR داده با کلید ۳۲ بایتی — حالت‌ها در XOR_MODE توضیح داده شده (ابهام متن/کد سند). متقارن است. */
export function xorWithKey(data: Buffer, key: Buffer, mode: 'PER_BLOCK' | 'FIRST_BLOCK_ONLY' = XOR_MODE): Buffer {
  const out = Buffer.from(data);
  const limit = mode === 'PER_BLOCK' ? data.length : Math.min(data.length, key.length);
  for (let i = 0; i < limit; i++) out[i] = data[i]! ^ key[i % key.length]!;
  return out;
}

/** AES-256-GCM بدون AAD، برچسب ۱۲۸ بیتی به انتهای متن رمزشده (مثل Java doFinal) — پیوست ۱-۴. */
export function aesGcmEncrypt(plain: Buffer, key: Buffer, iv: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

export function aesGcmDecrypt(blob: Buffer, key: Buffer, iv: Buffer): Buffer {
  const tag = blob.subarray(blob.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(0, blob.length - 16)), d.final()]);
}

/** RSA-OAEP با SHA-256 (و MGF1-SHA256 در OpenSSL) — پیوست ۱-۵. NEEDS-SANDBOX-VERIFICATION: جاوای SunJCE برای MGF1 پیش‌فرضش SHA-1 است. */
export function rsaOaepEncrypt(plain: Buffer, publicKey: KeyObject): Buffer {
  return publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, plain);
}

export function rsaOaepDecrypt(blob: Buffer, privateKey: KeyObject): Buffer {
  return privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, blob);
}

export type EncryptedInvoicePacketParts = {
  /** base64(AES-GCM(XOR(json, key))) */
  data: string;
  /** RSA-OAEP(کلید AES) به‌صورت base64 */
  symmetricKey: string;
  /** hex ۱۶ بایت */
  iv: string;
  dataSignature: string;
};

/** شاخه‌ی تصادفی برای تست؛ در تولید پیش‌فرض randomBytes. */
export type RandomSource = (n: number) => Buffer;

/**
 * رمز و امضای یک صورتحساب (سند ۶-۲-۲ و ۶-۳):
 *   dataSignature = RSA-SHA256( normalize(invoice) )   با کلید خصوصی مودی
 *   data = base64( AES-GCM( XOR(invoiceJson, aesKey) ) )
 *   symmetricKey = RSA-OAEP-SHA256( aesKey )  با کلید عمومی سازمان
 */
export function encryptInvoice(
  invoice: unknown,
  opts: { privateKey: KeyObject; serverPublicKey: KeyObject; random?: RandomSource },
): EncryptedInvoicePacketParts {
  const rnd = opts.random ?? randomBytes;
  const aesKey = rnd(32);
  const iv = rnd(16);
  const json = JSON.stringify(invoice);
  const dataSignature = signString(normalizeJson(invoice), opts.privateKey);
  const encrypted = aesGcmEncrypt(xorWithKey(Buffer.from(json, 'utf8'), aesKey), aesKey, iv);
  const keyMaterial = SYMMETRIC_KEY_WRAP_ENCODING === 'HEX_UTF8' ? Buffer.from(aesKey.toString('hex'), 'utf8') : aesKey;
  return {
    data: encrypted.toString('base64'),
    symmetricKey: rsaOaepEncrypt(keyMaterial, opts.serverPublicKey).toString('base64'),
    iv: iv.toString('hex'),
    dataSignature,
  };
}

/** معکوس encryptInvoice — برای تست رفت‌وبرگشت و ابزار عیب‌یابی (سمت سرور سازمان). */
export function decryptInvoicePacket(parts: EncryptedInvoicePacketParts, serverPrivateKey: KeyObject): unknown {
  const wrapped = rsaOaepDecrypt(Buffer.from(parts.symmetricKey, 'base64'), serverPrivateKey);
  const aesKey = SYMMETRIC_KEY_WRAP_ENCODING === 'HEX_UTF8' ? Buffer.from(wrapped.toString('utf8'), 'hex') : wrapped;
  const plain = xorWithKey(aesGcmDecrypt(Buffer.from(parts.data, 'base64'), aesKey, Buffer.from(parts.iv, 'hex')), aesKey);
  return JSON.parse(plain.toString('utf8'));
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
