import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * کد مجوز و لینک دانلود نسخه‌ی الکترونیک — منطق خالص و بدون وابستگی، تا با
 * ابزار مهرزنی (~/Documents/FunnelKing_build/ebook/license_stamp.py) بیت‌به‌بیت
 * یکی بماند: کد مجوز = HMAC-SHA256(secret, "order|phone") → base32 → ۱۶ نویسه‌ی
 * اول، به‌صورت FK-XXXX-XXXX-XXXX-XXXX. هر تغییری اینجا باید در اسکریپت پایتون هم
 * اعمال شود، وگرنه کدی که روی نسخه‌ی خریدار چاپ شده دیگر تأیید نمی‌شود.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** همان norm_phone پایتون: ارقام فارسی/عربی → لاتین، حذف غیررقم، 98… → 0…. */
export function normalizePhone(phone: string): string {
  let p = phone.replace(/[۰-۹٠-٩]/g, (d) => String(FA_DIGITS.includes(d) ? FA_DIGITS.indexOf(d) : AR_DIGITS.indexOf(d)));
  p = p.replace(/\D/g, '');
  if (p.startsWith('98')) p = '0' + p.slice(2);
  return p;
}

export function maskPhone(phone: string): string {
  const p = normalizePhone(phone);
  return p.length >= 8 ? `${p.slice(0, 4)}•••${p.slice(-4)}` : p;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (بدون padding) — معادل base64.b32encode پایتون. */
export function base32(buf: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function licenceCode(secret: string, orderNo: number | string, phone: string): string {
  const mac = createHmac('sha256', secret).update(`${orderNo}|${normalizePhone(phone)}`).digest();
  const b = base32(mac).slice(0, 16);
  return `FK-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** کد واردشده توسط کاربر را با فاصله/خط تیره/حروف کوچک هم می‌پذیرد. */
export function verifyLicenceCode(secret: string, orderNo: number | string, phone: string, code: string): boolean {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalized = cleaned.startsWith('FK') && cleaned.length === 18 ? cleaned.slice(2) : cleaned;
  if (normalized.length !== 16) return false;
  const given = `FK-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}`;
  return safeEqual(licenceCode(secret, orderNo, phone), given);
}

// ── لینک دانلود امضاشده ─────────────────────────────────────────────────────
// کلید امضای لینک از راز مجوز مشتق می‌شود (دامنه‌ی جدا با برچسب)، پس یک env کمتر
// و لو رفتن یک لینک هیچ چیزی درباره‌ی کد مجوز نمی‌گوید.

export interface DownloadToken {
  /** زمان انقضا — ثانیه‌ی یونیکس به مبنای ۳۶ (کوتاه برای پیامک) */
  e: string;
  /** امضا — base64url از ۱۶ بایت اول HMAC */
  s: string;
}

function downloadKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('fk-ebook-download-v1').digest();
}

function downloadSig(secret: string, orderId: string, exp: string): string {
  return createHmac('sha256', downloadKey(secret)).update(`${orderId}|${exp}`).digest().subarray(0, 16).toString('base64url');
}

/** یک توکن برای هر دو فایل (PDF و EPUB) همان سفارش — لینک پیامک کوتاه می‌ماند. */
export function signDownload(secret: string, orderId: string, ttlSeconds: number, now = Date.now()): DownloadToken {
  const e = Math.floor(now / 1000 + ttlSeconds).toString(36);
  return { e, s: downloadSig(secret, orderId, e) };
}

export type DownloadTokenCheck = 'ok' | 'expired' | 'invalid';

export function verifyDownload(secret: string, orderId: string, e: unknown, s: unknown, now = Date.now()): DownloadTokenCheck {
  if (typeof e !== 'string' || typeof s !== 'string' || !/^[0-9a-z]{1,10}$/.test(e) || !/^[A-Za-z0-9_-]{22}$/.test(s)) return 'invalid';
  if (!safeEqual(downloadSig(secret, orderId, e), s)) return 'invalid';
  return parseInt(e, 36) * 1000 < now ? 'expired' : 'ok';
}
