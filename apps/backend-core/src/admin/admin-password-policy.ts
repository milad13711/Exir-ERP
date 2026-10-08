import { randomBytes } from 'node:crypto';

/** رمزهای پیش‌فرضِ منتشرشده در مخزن (seed/README) — هرگز به‌عنوان رمز جدید پذیرفته نمی‌شوند. */
export const KNOWN_DEFAULT_PASSWORDS: ReadonlySet<string> = new Set(['ExirAdmin123!', 'ExirSupport123!']);

const DENY_SUBSTRINGS = ['exiradmin', 'exirsupport', 'password', 'qwerty', '123456789', 'exir123'];
export const MIN_ADMIN_PASSWORD = 12;
export const MAX_ADMIN_PASSWORD = 128;

export function isKnownDefaultPassword(password: string): boolean {
  return KNOWN_DEFAULT_PASSWORDS.has(password);
}

/** پیام فارسی خطا یا null اگر رمز پذیرفتنی است. `currentPassword` برای ردِ استفاده‌ی مجدد از رمز فعلی. */
export function validateAdminPassword(password: string, ctx: { email?: string; currentPassword?: string } = {}): string | null {
  if (password.length < MIN_ADMIN_PASSWORD) return `رمز عبور باید حداقل ${MIN_ADMIN_PASSWORD} نویسه باشد`;
  if (password.length > MAX_ADMIN_PASSWORD) return `رمز عبور حداکثر ${MAX_ADMIN_PASSWORD} نویسه می‌تواند باشد`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'رمز عبور باید هم حرف و هم عدد داشته باشد';
  if (/^(.)\1+$/.test(password)) return 'رمز عبور نباید یک نویسه‌ی تکراری باشد';
  const lower = password.toLowerCase();
  if (KNOWN_DEFAULT_PASSWORDS.has(password) || DENY_SUBSTRINGS.some((d) => lower.includes(d))) return 'این رمز عبور قابل حدس یا پیش‌فرض است؛ رمز دیگری انتخاب کنید';
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) return 'رمز عبور نباید شامل بخش نام‌کاربری ایمیل باشد';
  if (ctx.currentPassword !== undefined && password === ctx.currentPassword) return 'رمز جدید باید با رمز فعلی متفاوت باشد';
  return null;
}

/** رمز تصادفی یک‌بارمصرف که حتماً از سیاست رد نمی‌شود. فقط یک‌بار به SUPER_ADMIN نمایش داده می‌شود. */
export function generateOneTimePassword(email?: string): string {
  for (let i = 0; i < 20; i++) {
    const p = randomBytes(18).toString('base64url');
    if (validateAdminPassword(p, { email }) === null) return p;
  }
  throw new Error('could not generate a policy-compliant password');
}
