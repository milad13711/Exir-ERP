import { ForbiddenException } from '@nestjs/common';

/**
 * سیاست 2FA اجباری برای مالک/مدیر محیط کاری (ورود پیامکی به‌تنهایی در برابر SIM-swap کافی نیست).
 *  - off:     بدون الزام (رفتار قدیمی).
 *  - grace:   مهلت TENANT_2FA_GRACE_DAYS روز از اولین دیده‌شدن عضو؛ در مهلت فقط هشدار، بعد از آن نشست محدود.
 *  - enforce: بلافاصله نشست محدود تا ثبت 2FA.
 * پیش‌فرض env: grace. جایگزین تننت (Tenant.twoFactorPolicy) بر env مقدم است.
 */
export type TwoFactorMode = 'off' | 'grace' | 'enforce';

export const TWO_FACTOR_ENROLLMENT_REQUIRED = 'TWO_FACTOR_ENROLLMENT_REQUIRED';
export const DEFAULT_GRACE_DAYS = 14;
/** عمر توکن نشست محدود (ثانیه). */
export const RESTRICTED_TOKEN_TTL_SECONDS = 30 * 60;

/** تنها مسیرهای مجاز برای نشست محدود (بدون پیشوند‌های اضافه): پیشوندها و مسیرهای دقیق «METHOD /api/...». */
export const T2FA_ALLOWED_PREFIXES: readonly string[] = ['/api/auth/2fa/'];
export const T2FA_ALLOWED_EXACT: ReadonlySet<string> = new Set(['GET /api/me', 'POST /api/auth/logout']);

export function parseMode(v: string | null | undefined): TwoFactorMode | null {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'off' || s === 'grace' || s === 'enforce' ? s : null;
}

/** حالت مؤثر: جایگزین تننت > env > grace. */
export function effectiveMode(tenantOverride?: string | null, env: NodeJS.ProcessEnv = process.env): TwoFactorMode {
  return parseMode(tenantOverride) ?? parseMode(env.TENANT_REQUIRE_2FA_FOR_ADMINS) ?? 'grace';
}

export function graceDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TENANT_2FA_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 && env.TENANT_2FA_GRACE_DAYS !== undefined && env.TENANT_2FA_GRACE_DAYS !== '' ? Math.floor(n) : DEFAULT_GRACE_DAYS;
}

export type TwoFactorState = {
  mode: TwoFactorMode;
  /** سیاست برای این کاربر اعمال می‌شود (OWNER/ADMIN با نشست کاربری و mode≠off). */
  required: boolean;
  enrolled: boolean;
  graceEndsAt: string | null;
  /** نشست محدود: فقط ثبت 2FA مجاز است. */
  restricted: boolean;
};

export type TwoFactorInput = {
  mode: TwoFactorMode;
  role?: string;
  authType?: string;
  enrolled: boolean;
  graceStartedAt?: Date | null;
  now?: Date;
  graceDays?: number;
};

export function isPrivilegedRole(role?: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function evaluateTwoFactor(i: TwoFactorInput): TwoFactorState {
  const applies = i.authType === 'tenant_user' && isPrivilegedRole(i.role) && i.mode !== 'off';
  if (!applies) return { mode: i.mode, required: false, enrolled: i.enrolled, graceEndsAt: null, restricted: false };
  const now = (i.now ?? new Date()).getTime();
  const end = i.graceStartedAt ? new Date(i.graceStartedAt.getTime() + (i.graceDays ?? DEFAULT_GRACE_DAYS) * 86_400_000) : null;
  let restricted = false;
  if (!i.enrolled) restricted = i.mode === 'enforce' || (i.mode === 'grace' && end !== null && now >= end.getTime());
  return { mode: i.mode, required: true, enrolled: i.enrolled, graceEndsAt: i.mode === 'grace' && end ? end.toISOString() : null, restricted };
}

/** آیا این درخواست برای نشست محدود مجاز است؟ */
export function isAllowedForRestrictedSession(method: string, path: string): boolean {
  const p = path.split('?')[0].replace(/\/+$/, '');
  if (p.includes('..')) return false;
  if (T2FA_ALLOWED_EXACT.has(`${method.toUpperCase()} ${p}`)) return true;
  return T2FA_ALLOWED_PREFIXES.some((x) => p.startsWith(x));
}

export function twoFactorRequiredError(): ForbiddenException {
  return new ForbiddenException({ message: 'برای ادامه باید ورود دومرحله‌ای را فعال کنید', code: TWO_FACTOR_ENROLLMENT_REQUIRED });
}

/**
 * عملیات پرخطر (نقش/دسترسی، دعوت/غیرفعال‌سازی کاربر، خروجی/بازیابی پشتیبان، راز درگاه پرداخت/پیامک، کلید API):
 * وقتی سیاست «enforce» است (یا مهلت تمام شده) مالک/مدیرِ بدون 2FA نباید آن را انجام دهد.
 * کلید API (type=api_key) و کاربران عادی تحت تأثیر نیستند. ctx.twoFactor را JwtAuthGuard پر می‌کند.
 */
export function assertTwoFactorForSensitiveAction(ctx: { auth: { type?: string; role?: string }; twoFactor?: TwoFactorState }): void {
  const t = ctx.twoFactor;
  if (!t || ctx.auth.type !== 'tenant_user' || !isPrivilegedRole(ctx.auth.role)) return;
  if (!t.enrolled && (t.mode === 'enforce' || t.restricted)) throw twoFactorRequiredError();
}

/** اگر کاربر 2FA نداشت، آیا اکنون محدود می‌شد؟ (برای جلوگیری از غیرفعال‌سازی 2FA زیر سیاست الزام). */
export function wouldBeRestrictedWithout2FA(t: TwoFactorState, now: Date = new Date()): boolean {
  if (!t.required) return false;
  if (t.mode === 'enforce') return true;
  return t.mode === 'grace' && t.graceEndsAt !== null && now.getTime() >= new Date(t.graceEndsAt).getTime();
}
