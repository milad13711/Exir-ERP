import { randomBytes } from 'node:crypto';

/** منطق خالص (بدون وابستگی به DB) اعلان به‌روزرسانی ماژول‌ها: پاک‌سازی متن، مسیرهای مجاز، متن پیامک، سقف‌ها. */

export const RELEASE_TYPES = ['NEW', 'IMPROVED', 'FIX'] as const;
export type ReleaseChangeType = (typeof RELEASE_TYPES)[number];

export const RELEASE_CHANNELS = ['notify', 'ticket', 'sms'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
export type ChannelSelection = Record<ReleaseChannel, boolean>;

export const DELIVERY_CHANNEL: Record<ReleaseChannel, 'NOTIFY' | 'TICKET' | 'SMS'> = { notify: 'NOTIFY', ticket: 'TICKET', sms: 'SMS' };

export const LIMITS = {
  title: 120,
  summary: 600,
  changeTitle: 120,
  changeDescription: 1200,
  changeValue: 600,
  maxChanges: 40,
  version: 32,
} as const;

/** سقف پیامک: هر تننت حداکثر این تعداد پیامک «اعلان انتشار» در یک روز تهران (در مجموع انتشارها). */
export const SMS_TENANT_DAILY_CAP = 6;
/** در هر انتشار فقط به این تعداد مدیر/مالک هر تننت پیامک می‌رود. */
export const SMS_MAX_RECIPIENTS_PER_TENANT = 3;
/** ردیف PENDING قدیمی‌تر از این (ms) متروک حساب می‌شود و تلاش مجدد می‌تواند دوباره برش دارد. */
export const STALE_PENDING_MS = 10 * 60_000;

/** مسیر پیش‌فرض صفحه‌ی هر ماژول در پنل تننت (همسو با web-panel/src/components/layout/nav.ts). */
export const MODULE_ROUTES: Record<string, string> = {
  crm: '/crm',
  sales: '/sales',
  booking: '/booking',
  contracts: '/contracts',
  proposals: '/proposals',
  mentoring: '/mentoring',
  events: '/events',
  forms: '/forms',
  warranty: '/warranty',
  'after-sales-service': '/after-sales',
  voip: '/calls',
  marketing: '/marketing',
  'online-store': '/online-store',
  'book-store': '/book-store',
  'referral-marketing': '/referral-marketing',
  purchasing: '/purchasing',
  warehouse: '/warehouse',
  production: '/production',
  'quality-control': '/quality-control',
  'ration-lab': '/ration-lab',
  accounting: '/accounting',
  checks: '/checks',
  tax: '/tax',
  hr: '/hr',
  recruitment: '/recruitment',
  certificates: '/certificates',
  projects: '/projects',
  messenger: '/messenger',
  correspondence: '/correspondence',
  operations: '/operations',
  fleet: '/fleet',
  dispatch: '/dispatch',
  automation: '/automation',
  'qr-code': '/qr-code',
  reports: '/reports',
  'confidential-archive': '/confidential-archive',
  tasks: '/tasks',
};

/** ریشه‌های مجاز لینک (بخش اول مسیر) — فقط صفحه‌های داخلی شناخته‌شده‌ی پنل. */
export const ALLOWED_ROUTE_ROOTS: ReadonlySet<string> = new Set([
  ...Object.values(MODULE_ROUTES).map((p) => p.split('/')[1]),
  'dashboard',
  'approvals',
  'modules',
  'settings',
]);

export function defaultRouteFor(moduleCode: string): string | null {
  return MODULE_ROUTES[moduleCode] ?? null;
}

/**
 * متن ساده: بدون HTML/تگ، بدون نویسه‌ی کنترلی، فاصله‌های اضافه جمع‌شده. `multiline` خط‌جدید را نگه می‌دارد.
 * (نمایش در React بدون dangerouslySetInnerHTML است؛ این لایه‌ی دفاعی دوم است.)
 */
export function plainText(input: unknown, max: number, multiline = false): string {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFC');
  s = s.replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ');
  // eslint-disable-next-line no-control-regex
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g : /[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g, ' ');
  s = multiline ? s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

export function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LIMITS.version && /^[0-9A-Za-z][0-9A-Za-z.\-+]*$/.test(v);
}

/**
 * لینک عمیق: فقط مسیر نسبی داخلی با ریشه‌ی مجاز، بدون `//`، `..`، اسکیم یا بک‌اسلش؛ کوئری ساده‌ی ?a=b&c=d مجاز است.
 * null/خالی مجاز (یعنی مسیر پیش‌فرض ماژول).
 */
export function normalizeDeepLink(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  if (s.length > 200 || !isSafeDeepLink(s)) throw new Error('INVALID_DEEP_LINK');
  return s;
}

export function isSafeDeepLink(s: string): boolean {
  if (!/^\/[a-z0-9][a-z0-9\-/]*(\?[A-Za-z0-9_\-=&.]*)?$/.test(s)) return false;
  const path = s.split('?')[0];
  if (path.includes('//') || path.includes('..')) return false;
  return ALLOWED_ROUTE_ROOTS.has(path.split('/')[1]);
}

export type ChangeInput = { type?: unknown; title?: unknown; description?: unknown; valueText?: unknown; deepLink?: unknown };
export type CleanChange = { type: ReleaseChangeType; title: string; description: string; valueText: string; deepLink: string | null };

export class ReleaseValidationError extends Error {}

export function cleanChange(c: ChangeInput, index: number): CleanChange {
  const type = (RELEASE_TYPES as readonly string[]).includes(String(c.type)) ? (c.type as ReleaseChangeType) : 'NEW';
  const title = plainText(c.title, LIMITS.changeTitle);
  if (!title) throw new ReleaseValidationError(`عنوان تغییر شماره ${index + 1} الزامی است`);
  let deepLink: string | null;
  try {
    deepLink = normalizeDeepLink(c.deepLink);
  } catch {
    throw new ReleaseValidationError(`لینک تغییر شماره ${index + 1} مجاز نیست؛ فقط مسیر داخلی یکی از صفحه‌های ماژول‌ها (مثل /sales) پذیرفته می‌شود`);
  }
  return {
    type,
    title,
    description: plainText(c.description, LIMITS.changeDescription, true),
    valueText: plainText(c.valueText, LIMITS.changeValue, true),
    deepLink,
  };
}

export function cleanChanges(list: unknown): CleanChange[] {
  if (!Array.isArray(list)) return [];
  if (list.length > LIMITS.maxChanges) throw new ReleaseValidationError(`حداکثر ${LIMITS.maxChanges} تغییر برای هر انتشار مجاز است`);
  return list.map((c, i) => cleanChange((c ?? {}) as ChangeInput, i));
}

export function normalizeChannels(input: unknown): ChannelSelection {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return { notify: o.notify === true, ticket: o.ticket === true, sms: o.sms === true };
}

/** کد کوتاه (۷ نویسه، الفبای بدون ابهام) برای لینک پیامک. */
export function newShortCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(7);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function releaseLink(shortCode: string, baseUrl = process.env.WEB_PANEL_PUBLIC_URL ?? ''): string {
  return `${baseUrl.replace(/\/$/, '')}/releases/${shortCode}`;
}

/** مسیر نسبی داخل پنل برای اعلان درون‌برنامه. */
export function releasePath(shortCode: string): string {
  return `/releases/${shortCode}`;
}

/**
 * متن پیامک: فقط نام ماژول (از کاتالوگ) و شماره‌ی نسخه (اعتبارسنجی‌شده) + لینک کوتاه؛ هیچ متن آزاد ادمین داخل پیامک نمی‌رود،
 * تا تزریق لینک/محتوا ممکن نباشد. نام ماژول از نویسه‌های کنترلی/لینک‌نما پاک می‌شود.
 */
export function buildSmsText(moduleName: string, version: string, link: string): string {
  const name = plainText(moduleName, 40).replace(/https?:\/\/\S+|www\.\S+/gi, '').trim();
  const ver = isValidVersion(version) ? version : '';
  return `اکسیر: ماژول ${name} به‌روز شد${ver ? ` (نسخه ${ver})` : ''}. تازه‌ها: ${link}`;
}

export function notificationText(moduleName: string, release: { version: string; title: string; summary: string }): { title: string; body: string } {
  return {
    title: plainText(`به‌روزرسانی ${moduleName} — نسخه ${release.version}`, 140),
    body: plainText(release.title, 200),
  };
}

export function ticketText(moduleName: string, release: { version: string; title: string; summary: string }, changes: CleanChange[], link: string): { subject: string; body: string } {
  const label: Record<ReleaseChangeType, string> = { NEW: 'جدید', IMPROVED: 'بهبود', FIX: 'رفع مشکل' };
  const lines = [
    `ماژول «${moduleName}» به نسخه ${release.version} به‌روز شد: ${release.title}`,
    release.summary,
    '',
    ...changes.slice(0, 10).map((c) => `• [${label[c.type]}] ${c.title}${c.valueText ? ` — ${c.valueText.split('\n')[0]}` : ''}`),
    changes.length > 10 ? `و ${changes.length - 10} مورد دیگر...` : '',
    '',
    `جزئیات کامل و دکمه‌ی رفتن به ماژول: ${link}`,
  ];
  return { subject: plainText(`به‌روزرسانی ${moduleName} (نسخه ${release.version}): ${release.title}`, 200), body: lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim() };
}

/** تنظیم تننت برای دریافت اعلان انتشارها: اعلان درون‌برنامه و تیکت opt-out (پیش‌فرض روشن)؛ پیامک opt-in (پیش‌فرض خاموش) چون از اعتبار پیامک خود تننت کسر می‌شود. */
export type TenantReleasePrefs = { notify: boolean; ticket: boolean; sms: boolean };
export const RELEASE_PREFS_KEY = { moduleCode: 'platform', key: 'release-announcements' } as const;
export function normalizePrefs(v: unknown): TenantReleasePrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { notify: o.notify !== false, ticket: o.ticket !== false, sms: o.sms === true };
}

/** روز تهران (UTC+3:30) به‌صورت YYYY-MM-DD برای کلید سقف روزانه. */
export function tehranDay(now: Date): string {
  return new Date(now.getTime() + 12_600_000).toISOString().slice(0, 10);
}

export type DeliveryStatus = 'PENDING' | 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

/** تلاش مجدد: کدام ردیف‌ها دوباره پردازش شوند؟ SENT و SKIPPED‌های نهایی (انصراف/بدون گیرنده) هرگز. */
export const RETRYABLE_SKIP_REASONS: ReadonlySet<string> = new Set(['DAILY_CAP', 'NO_SMS_CHANNEL', 'NO_PUBLIC_URL']);
export function isRetryable(row: { status: string; reason?: string | null; updatedAt: Date }, now: Date): boolean {
  if (row.status === 'FAILED' || row.status === 'PARTIAL') return true;
  if (row.status === 'PENDING') return now.getTime() - row.updatedAt.getTime() > STALE_PENDING_MS;
  if (row.status === 'SKIPPED') return RETRYABLE_SKIP_REASONS.has(row.reason ?? '');
  return false;
}
