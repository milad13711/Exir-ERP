import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

/** TOTP مطابق RFC 6238 (SHA-1، ۶ رقم، گام ۳۰ ثانیه) — سازگار با Google Authenticator / Authy / 1Password، بدون وابستگی خارجی. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
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

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCodeAt(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * بررسی کد با پنجره‌ی ±۱ گام. lastUsedStep برای جلوگیری از بازپخش (replay) همان کد: گامی که قبلاً مصرف شده پذیرفته نمی‌شود.
 * خروجی: گام منطبق یا null.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { nowMs?: number; lastUsedStep?: number | null; window?: number } = {}): number | null {
  const c = (code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = currentStep(opts.nowMs);
  const w = opts.window ?? 1;
  let matched: number | null = null;
  for (let d = -w; d <= w; d += 1) {
    const step = now + d;
    // بدون short-circuit تا زمان پاسخ به محل تطبیق وابسته نشود
    if (timingSafeStr(totpCodeAt(secretBase32, step), c) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (opts.lastUsedStep != null && matched <= opts.lastUsedStep) return null;
  return matched;
}

function timingSafeStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function otpauthUrl(label: string, secretBase32: string, issuer = 'Exir ERP'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** کدهای بازیابی: ۱۰ کد تک‌مصرف xxxxx-xxxxx؛ فقط هش SHA-256 ذخیره می‌شود (آنتروپی ~۵۰ بیت، نیازی به bcrypt نیست). */
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const pick = () => Array.from({ length: 5 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join('');
    return `${pick()}-${pick()}`;
  });
}
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
