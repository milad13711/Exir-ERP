import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * منطق خالص اعلان/پوش (بدون Prisma/Nest) تا بدون سرور قابل‌آزمون باشد:
 * دسته‌بندی، ماتریس تصمیم کانال × ترجیح × ساعات سکوت، TTL/urgency، ساخت payload، توکن‌های HMAC (ack / چرخش اشتراک)،
 * طبقه‌بندی خطای سرویس پوش، برچسب دستگاه، سقف پیامک جایگزین و محدودکننده‌ی نرخ.
 */

export const NOTIFICATION_CATEGORIES = ['messenger', 'tasks', 'reminders', 'correspondence', 'approvals', 'system', 'marketing'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type ChannelPref = { push?: boolean; inApp?: boolean; sms?: boolean };
export type CategoryPrefs = Partial<Record<NotificationCategory, ChannelPref>>;

export type PrefsLike = {
  smsEnabled?: boolean | null;
  categoryPrefs?: unknown;
  quietHoursEnabled?: boolean | null;
  quietStart?: string | null;
  quietEnd?: string | null;
  smsFallbackEnabled?: boolean | null;
} | null;

/** نوع اعلان (مثل task.assigned) → دسته. نوع ناشناخته = system. */
export function categoryForType(type: string): NotificationCategory {
  const t = type.toLowerCase();
  if (t.startsWith('messenger')) return 'messenger';
  if (t.startsWith('task')) return 'tasks';
  if (t.startsWith('reminder') || t.startsWith('calendar') || t.startsWith('checklist')) return 'reminders';
  if (t.startsWith('correspondence') || t.startsWith('letter')) return 'correspondence';
  if (t.startsWith('approval') || t.startsWith('leave')) return 'approvals';
  if (t.startsWith('marketing') || t.startsWith('campaign') || t.startsWith('promo')) return 'marketing';
  return 'system';
}

/** حیاتی = از ساعات سکوت معاف (آلارم موعد، امنیتی). صریحِ فراخواننده هم پذیرفته می‌شود. */
export function isCriticalType(type: string, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const t = type.toLowerCase();
  return t.startsWith('reminder.alarm') || t.startsWith('security.') || t.startsWith('auth.');
}

export function normalizeCategory(value: string | null | undefined): NotificationCategory | null {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value ?? '') ? (value as NotificationCategory) : null;
}

/** پیش‌فرض‌ها: بازاریابی پوش ندارد؛ بقیه پوش و درون‌برنامه روشن. */
const DEFAULT_PUSH: Record<NotificationCategory, boolean> = {
  messenger: true,
  tasks: true,
  reminders: true,
  correspondence: true,
  approvals: true,
  system: true,
  marketing: false,
};

export function sanitizeCategoryPrefs(raw: unknown): CategoryPrefs {
  const out: CategoryPrefs = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const cat of NOTIFICATION_CATEGORIES) {
    const v = (raw as Record<string, unknown>)[cat];
    if (!v || typeof v !== 'object') continue;
    const pref: ChannelPref = {};
    for (const ch of ['push', 'inApp', 'sms'] as const) {
      const b = (v as Record<string, unknown>)[ch];
      if (typeof b === 'boolean') pref[ch] = b;
    }
    if (Object.keys(pref).length) out[cat] = pref;
  }
  return out;
}

/** «HH:mm» → دقیقه از نیمه‌شب؛ نامعتبر → null. */
export function parseHHmm(v: string | null | undefined): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((v ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function tehranMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** پنجره‌ی سکوت [start, end) با پشتیبانی از عبور از نیمه‌شب (۲۲:۰۰ تا ۰۷:۰۰). start==end ⇒ سکوت ۲۴ساعته نیست (خاموش). */
export function inQuietHours(nowMin: number, start: string | null | undefined, end: string | null | undefined): boolean {
  const s = parseHHmm(start);
  const e = parseHHmm(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

export type DeliveryPlan = { inApp: boolean; push: boolean; sms: boolean; quiet: boolean };

export function planDelivery(
  prefs: PrefsLike,
  opts: { category: NotificationCategory; critical: boolean; now?: Date; channels?: { push?: boolean; email?: boolean; sms?: boolean } },
): DeliveryPlan {
  const cat = sanitizeCategoryPrefs(prefs?.categoryPrefs)[opts.category] ?? {};
  const quiet = Boolean(prefs?.quietHoursEnabled) && inQuietHours(tehranMinutes(opts.now ?? new Date()), prefs?.quietStart, prefs?.quietEnd);
  const suppressed = quiet && !opts.critical;
  // انتخاب صریح فراخواننده (مثلاً یادآوری تقویم: فقط کانال‌های انتخابیِ همان یادآوری) جایگزین ترجیح دسته می‌شود
  const wantPush = opts.channels?.push ?? cat.push ?? DEFAULT_PUSH[opts.category];
  const wantSms = opts.channels?.sms ?? cat.sms ?? Boolean(prefs?.smsEnabled);
  return {
    inApp: opts.critical ? true : (cat.inApp ?? true),
    push: wantPush && !suppressed,
    sms: wantSms && !suppressed,
    quiet,
  };
}

// ── urgency / TTL ───────────────────────────────────────────────────────────
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

export function pushTiming(category: NotificationCategory, critical: boolean): { urgency: PushUrgency; ttl: number } {
  if (critical) return { urgency: 'high', ttl: 10 * 60 };
  switch (category) {
    case 'reminders':
      return { urgency: 'high', ttl: 60 * 60 };
    case 'messenger':
      return { urgency: 'normal', ttl: 24 * 3600 };
    case 'marketing':
      return { urgency: 'low', ttl: 12 * 3600 };
    case 'system':
      return { urgency: 'normal', ttl: 12 * 3600 };
    default:
      return { urgency: 'normal', ttl: 24 * 3600 };
  }
}

// ── payload ─────────────────────────────────────────────────────────────────
export type PushPayloadInput = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  actions?: { action: string; title: string }[];
  category?: NotificationCategory;
  ackToken?: string;
  requireInteraction?: boolean;
  renotify?: boolean;
  /** اگر برنامه همین الان باز و قابل‌مشاهده است، SW اعلان سیستمی نشان ندهد و فقط به برنامه خبر بدهد. */
  silentIfVisible?: boolean;
  /** شناسه‌ی اعلان درون‌برنامه/رخداد برای deep-link (مثلاً شناسه‌ی یادآوری برای دکمه‌های «انجام شد/۱۰ دقیقه دیگر») */
  entityType?: string | null;
  entityId?: string | null;
  /** تعداد نخوانده برای badge آیکون برنامه (Badging API) */
  badgeCount?: number;
};

const MAX_PAYLOAD_BYTES = 3800; // سقف استاندارد ۴۰۹۶ پس از رمزنگاری؛ کمی حاشیه ایمن

function clip(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
}

/** فقط مسیرهای درون‌برنامه: «/…» بدون «//»، «\\»، کاراکتر کنترلی و با origin یکسان پس از پارس؛ هرچیز دیگر → /dashboard. */
export function safeInternalPath(url: string | null | undefined): string {
  if (typeof url !== 'string' || url.length > 1024 || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return '/dashboard';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) return '/dashboard';
  try {
    const base = 'https://internal.invalid';
    return new URL(url, base).origin === base ? url : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export function buildPushPayload(input: PushPayloadInput): { json: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {
    v: 1,
    title: clip(input.title || 'اکسیر ERP', 120),
    body: clip(input.body ?? '', 240),
    url: safeInternalPath(input.url),
    ...(input.tag ? { tag: clip(input.tag, 64) } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.ackToken ? { ackToken: input.ackToken } : {}),
    ...(input.requireInteraction ? { requireInteraction: true } : {}),
    ...(input.renotify ? { renotify: true } : {}),
    ...(input.silentIfVisible ? { silentIfVisible: true } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(typeof input.badgeCount === 'number' && input.badgeCount >= 0 ? { badgeCount: Math.min(input.badgeCount, 999) } : {}),
    ...(input.actions?.length ? { actions: input.actions.slice(0, 2).map((a) => ({ action: clip(a.action, 24), title: clip(a.title, 24) })) } : {}),
    ts: Date.now(),
  };
  let json = JSON.stringify(data);
  // کوتاه‌سازی تدریجی بدنه تا در سقف بایت بنشیند (متن فارسی ۲–۳ بایت به ازای هر نویسه)
  let body = String(data.body);
  while (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES && body.length > 0) {
    const keep = Math.floor([...body].length * 0.7);
    body = keep < 2 ? '' : clip(body, keep);
    data.body = body;
    json = JSON.stringify(data);
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
    data.title = clip(String(data.title), 40);
    delete data.actions;
    json = JSON.stringify(data);
  }
  return { json, data };
}

// ── tokens (HMAC) ───────────────────────────────────────────────────────────
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function deriveKey(master: Buffer | string, domain: string): Buffer {
  return createHmac('sha256', master).update(domain).digest();
}

export const ACK_DOMAIN = 'exir:push-ack:v1';
export const ROTATE_DOMAIN = 'exir:push-rotate:v1';
export const ACK_TTL_SEC = 7 * 24 * 3600;
/** توکن چرخش: ۴۵ روز، لغزنده (با هر subscribe/sync/rotate تمدید و نونس عوض می‌شود). */
export const ROTATE_TTL_SEC = 45 * 24 * 3600;

export type AckClaims = { n: string; u: string; t: string };
/** s=شناسه‌ی اشتراک، u=کاربر، t=تننت، k=nonce یک‌بارمصرف زنجیره، v=نسخه‌ی مؤثر نشست عضو هنگام صدور */
export type RotateClaims = { s: string; u: string; t: string; k: string; v: number };

function signClaims(claims: object, key: Buffer, ttlSec: number, nowMs: number): string {
  const body = b64u(JSON.stringify({ ...claims, e: Math.floor(nowMs / 1000) + ttlSec }));
  return `${body}.${b64u(createHmac('sha256', key).update(body).digest())}`;
}

function verifyClaims<T extends object>(token: unknown, key: Buffer, nowMs: number): (T & { e: number }) | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', key).update(body).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { e: number };
    if (typeof claims.e !== 'number' || claims.e * 1000 < nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}

export const signAckToken = (c: AckClaims, key: Buffer, nowMs = Date.now()) => signClaims(c, key, ACK_TTL_SEC, nowMs);
export const verifyAckToken = (token: unknown, key: Buffer, nowMs = Date.now()) => {
  const c = verifyClaims<AckClaims>(token, key, nowMs);
  return c && typeof c.n === 'string' && typeof c.u === 'string' && typeof c.t === 'string' ? c : null;
};
export const signRotateToken = (c: RotateClaims, key: Buffer, nowMs = Date.now()) => signClaims(c, key, ROTATE_TTL_SEC, nowMs);
export const verifyRotateToken = (token: unknown, key: Buffer, nowMs = Date.now()) => {
  const c = verifyClaims<RotateClaims>(token, key, nowMs);
  return c && typeof c.s === 'string' && typeof c.u === 'string' && typeof c.t === 'string' && typeof c.k === 'string' && typeof c.v === 'number' ? c : null;
};

// ── error classification ────────────────────────────────────────────────────
export type FailureKind = { status: 'expired' | 'failed'; reason: string; httpCode: number | null; deleteNow: boolean; countsAsFailure: boolean };

export const MAX_CONSECUTIVE_FAILURES = 8;

export function classifyPushError(err: unknown): FailureKind {
  const code = (err as { statusCode?: number } | null)?.statusCode;
  const msg = err instanceof Error ? err.message : String(err);
  if ((err as { code?: string } | null)?.code === 'ESSRF') return { status: 'failed', reason: 'endpoint_blocked', httpCode: null, deleteNow: true, countsAsFailure: true };
  if (code === 404 || code === 410) return { status: 'expired', reason: 'expired', httpCode: code, deleteNow: true, countsAsFailure: true };
  if (code === 401 || code === 403) return { status: 'failed', reason: code === 401 ? 'unauthorized' : 'vapid_mismatch', httpCode: code, deleteNow: false, countsAsFailure: true };
  if (code === 413) return { status: 'failed', reason: 'payload_too_large', httpCode: code, deleteNow: false, countsAsFailure: false };
  if (code === 429) return { status: 'failed', reason: 'rate_limited', httpCode: code, deleteNow: false, countsAsFailure: false };
  if (code && code >= 500) return { status: 'failed', reason: 'push_service_error', httpCode: code, deleteNow: false, countsAsFailure: false };
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) {
    return { status: 'failed', reason: 'network', httpCode: code ?? null, deleteNow: false, countsAsFailure: false };
  }
  return { status: 'failed', reason: 'unknown', httpCode: code ?? null, deleteNow: false, countsAsFailure: true };
}

/** شکست‌های گذرا (شبکه/۵xx/۴۲۹/۴۱۳) به شمار شکست‌های پیاپی اشتراک اضافه نمی‌شوند. */
export function reasonCountsAsFailure(reason: string): boolean {
  return reason === 'expired' || reason === 'unauthorized' || reason === 'vapid_mismatch' || reason === 'unknown';
}

/** پس از ثبت یک شکست، آیا اشتراک باید حذف شود؟ (۴۰۴/۴۱۰ فوری؛ شکست‌های پیاپی غیرگذرا پس از آستانه) */
export function shouldDeleteAfterFailure(kind: FailureKind, previousFailures: number): boolean {
  if (kind.deleteNow) return true;
  return kind.countsAsFailure && previousFailures + 1 >= MAX_CONSECUTIVE_FAILURES;
}

export const FAILURE_REASON_FA: Record<string, string> = {
  expired: 'اشتراک این دستگاه منقضی یا لغو شده (حذف شد؛ دوباره فعال کنید)',
  unauthorized: 'سرویس پوش مرورگر درخواست را نپذیرفت (۴۰۱) — کلید سرور',
  vapid_mismatch: 'کلید VAPID با اشتراک دستگاه نمی‌خواند (۴۰۳) — «اصلاح خودکار» را بزنید',
  payload_too_large: 'اندازه‌ی پیام از حد مجاز بیشتر بود (۴۱۳)',
  rate_limited: 'سرویس پوش موقتاً محدودیت نرخ اعمال کرد (۴۲۹)',
  push_service_error: 'خطای موقت سرویس پوش مرورگر (۵xx)',
  network: 'قطعی یا کندی شبکه‌ی سرور تا سرویس پوش (timeout)',
  unknown: 'خطای نامشخص',
  endpoint_not_allowed: 'نشانی سرویس پوش این دستگاه مجاز نیست (حذف شد)؛ دوباره فعال کنید',
  endpoint_blocked: 'نشانی سرویس پوش به شبکه‌ی داخلی اشاره می‌کند و مسدود شد',
  ok: 'ارسال به سرویس پوش انجام شد',
  disabled: 'پوش برای این دسته/ساعت (سکوت) غیرفعال بود',
  no_device: 'هیچ دستگاهی ثبت نشده است',
};

// ── device label ────────────────────────────────────────────────────────────
export function deviceLabelFromUserAgent(ua: string | null | undefined): string {
  const s = ua ?? '';
  if (!s) return 'دستگاه ناشناس';
  const os = /iPhone/i.test(s)
    ? 'iPhone'
    : /iPad/i.test(s)
      ? 'iPad'
      : /Android/i.test(s)
        ? 'Android'
        : /Windows/i.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/i.test(s)
            ? 'macOS'
            : /CrOS/i.test(s)
              ? 'ChromeOS'
              : /Linux/i.test(s)
                ? 'Linux'
                : 'نامشخص';
  const browser = /SamsungBrowser/i.test(s)
    ? 'Samsung Internet'
    : /EdgA?\/|Edg\//i.test(s)
      ? 'Edge'
      : /OPR\/|Opera/i.test(s)
        ? 'Opera'
        : /Firefox|FxiOS/i.test(s)
          ? 'Firefox'
          : /CriOS|Chrome\//i.test(s)
            ? 'Chrome'
            : /Safari\//i.test(s)
              ? 'Safari'
              : 'مرورگر';
  return `${browser} روی ${os}`;
}

// ── SMS fallback cap ────────────────────────────────────────────────────────
export const SMS_FALLBACK_DAILY_CAP = 3;
export const SMS_FALLBACK_COOLDOWN_MS = 10 * 60_000;

export function shouldSmsFallback(a: {
  enabled: boolean;
  important: boolean;
  /** حداقل یک دستگاه ارسال موفق داشت */
  pushOk: boolean;
  smsInLast24h: number;
  lastSmsAt: Date | null;
  now?: Date;
}): boolean {
  if (!a.enabled || !a.important || a.pushOk) return false;
  if (a.smsInLast24h >= SMS_FALLBACK_DAILY_CAP) return false;
  const now = (a.now ?? new Date()).getTime();
  if (a.lastSmsAt && now - a.lastSmsAt.getTime() < SMS_FALLBACK_COOLDOWN_MS) return false;
  return true;
}

// ── tiny sliding-window limiter (در حافظه) ───────────────────────────────────
export class SlidingRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    this.hits.set(key, recent);
    return true;
  }
}

/** topic هدر Web Push: ≤۳۲ نویسه‌ی URL-safe — برای جایگزینی پیام‌های هم‌تگ در سرویس پوش وقتی دستگاه آفلاین است. */
export function pushTopic(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  return createHmac('sha256', 'exir-push-topic').update(tag).digest('base64url').slice(0, 32);
}

// ── allowlist سرویس‌های پوش (ضد SSRF) ─────────────────────────────────────────
const PUSH_HOSTS_EXACT = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

/** endpoint اشتراک فقط https روی پورت پیش‌فرض و میزبانِ دقیقاً یکی از سرویس‌های پوش شناخته‌شده (نه includes). */
export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h || /^[\d.]+$/.test(h) || h.includes(':')) return false; // IP literal
  if (PUSH_HOSTS_EXACT.has(h)) return true;
  return PUSH_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

// ── پیامک: روز تهران، کلید claim، قالب ثابت ──────────────────────────────────
export function tehranDateKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const SMS_DAILY_CAP_DEFAULT = 20;
export function smsDailyCap(env: string | undefined = process.env.NOTIFY_SMS_DAILY_CAP): number {
  const n = Number(env);
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : SMS_DAILY_CAP_DEFAULT;
}

/** کلید یکتای claim: kind = sms | smsfb | smsfb-cd. */
export function claimKey(kind: string, userId: string, slot: string | number, index?: number): string {
  return `${kind}:${userId}:${slot}${index !== undefined ? `:${index}` : ''}`;
}

/** SMS رسمی: فقط قالب ثابت + عنوان کوتاه‌شده (بدنه/متن آزاد و لینک‌ها حذف می‌شوند). */
export function smsText(title: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = title.replace(/https?:\/\/\S+/gi, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `اکسیر: ${clip(clean, 50) || 'اعلان جدید'}\nبرای مشاهده وارد برنامه شوید`;
}
