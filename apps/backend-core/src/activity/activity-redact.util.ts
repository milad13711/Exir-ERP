/** ابزارهای ماسک/حذف داده‌ی حساس برای لاگ فعالیت‌ها — هرگز متن کامل پیامک، توکن یا IP کامل ذخیره نمی‌شود. */

/** 09123456789 → 0912•••789؛ مقدار نامعتبر/کوتاه کاملاً ماسک می‌شود. */
export function maskPhone(phone: string | null | undefined): string {
  const p = (phone ?? '').replace(/\s+/g, '');
  if (p.length < 7) return '•••';
  return `${p.slice(0, 4)}•••${p.slice(-3)}`;
}

/** IPv4: آخرین بخش حذف؛ IPv6: فقط سه گروه اول. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/i, '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return clean.split('.').slice(0, 3).join('.') + '.x';
  if (clean.includes(':')) return clean.split(':').slice(0, 3).join(':') + '::';
  return null;
}

const URL_RE = /(https?:\/\/|www\.)\S+/gi;
const DIGITS_RE = /[0-9۰-۹٠-٩]{4,}/g;
const OTP_HINT_RE = /(کد\s*(ورود|تایید|تأیید|یکبار|یک‌بار|فعال)|رمز|otp|verification|passcode|password)/i;

export const SMS_PREVIEW_MAX = 60;

/**
 * پیش‌نمایش بی‌خطر پیامک: لینک‌ها → [لینک]، هر دنباله‌ی ۴+ رقمی → ••••، و برش به ۶۰ نویسه.
 * پیامک‌هایی که شبیه کد یک‌بارمصرف/رمز هستند اصلاً پیش‌نمایش ندارند (null).
 */
export function redactSmsPreview(message: string): string | null {
  if (!message) return null;
  if (OTP_HINT_RE.test(message)) return null;
  const redacted = message.replace(URL_RE, '[لینک]').replace(DIGITS_RE, '••••').replace(/\s+/g, ' ').trim();
  return redacted.length > SMS_PREVIEW_MAX ? `${redacted.slice(0, SMS_PREVIEW_MAX)}…` : redacted;
}

/** تعداد بخش‌های پیامک (فارسی ۷۰/۶۷؛ لاتین ۱۶۰/۱۵۳) — نسخه‌ی مستقل تا لاگ به سرویس پیامک وابسته نشود. */
export function smsPartCount(message: string): number {
  const unicode = /[^\x00-\x7F]/.test(message);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return message.length <= single ? 1 : Math.ceil(message.length / multi);
}
