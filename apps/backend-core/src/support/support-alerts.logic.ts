/** منطق خالصِ اعلان تیکت پشتیبانی برای کارکنان تننت مادر (بدون وابستگی به دیتابیس تا تست‌پذیر باشد). */

export type TicketAlertRole = 'OWNER' | 'ADMIN';

export type TicketAlertSettings = {
  /** کلید اصلی: خاموش = هیچ اعلان تیکتی برای کارکنان تننت مادر ساخته نمی‌شود */
  enabled: boolean;
  /** نقش‌های دریافت‌کننده؛ پیش‌فرض مالک و مدیر تننت مادر */
  roles: TicketAlertRole[];
  /** کاربران اضافه‌ی تننت مادر (شناسه‌ی User تننتی) مثل کارشناس پشتیبانی */
  extraUserIds: string[];
  push: boolean;
  sms: boolean;
  /** سقف پیامک تیکت در روز برای هر نفر */
  smsDailyCap: number;
  /** حداقل فاصله بین دو اعلان «پیام جدید» روی یک تیکت برای هر نفر (ثانیه) */
  replyCooldownSec: number;
  /** وقتی کارشناس جواب داد، سازنده‌ی تیکت اعلان (پوش) بگیرد */
  notifyCreatorOnReply: boolean;
  /** سقف ساعتی برای هر تننت (تیکت جدید / پیام) و برای هر کاربر؛ بالاتر از سقف فقط پوش، بدون پیامک */
  tenantTicketsPerHour: number;
  tenantMessagesPerHour: number;
  userTicketsPerHour: number;
  userMessagesPerHour: number;
};

export const TICKET_ALERT_DEFAULTS: TicketAlertSettings = {
  enabled: true,
  roles: ['OWNER', 'ADMIN'],
  extraUserIds: [],
  push: true,
  sms: true,
  smsDailyCap: 15,
  replyCooldownSec: 120,
  notifyCreatorOnReply: true,
  tenantTicketsPerHour: 10,
  tenantMessagesPerHour: 30,
  userTicketsPerHour: 5,
  userMessagesPerHour: 15,
};

export function normalizeTicketAlertSettings(raw: unknown): TicketAlertSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = TICKET_ALERT_DEFAULTS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const int = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  const roles = Array.isArray(r.roles) ? (r.roles.filter((x) => x === 'OWNER' || x === 'ADMIN') as TicketAlertRole[]) : d.roles;
  const extra = Array.isArray(r.extraUserIds) ? r.extraUserIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64) : [];
  return {
    enabled: bool(r.enabled, d.enabled),
    roles: [...new Set(roles)],
    extraUserIds: [...new Set(extra)].slice(0, 50),
    push: bool(r.push, d.push),
    sms: bool(r.sms, d.sms),
    smsDailyCap: int(r.smsDailyCap, d.smsDailyCap, 0, 200),
    replyCooldownSec: int(r.replyCooldownSec, d.replyCooldownSec, 0, 3600),
    notifyCreatorOnReply: bool(r.notifyCreatorOnReply, d.notifyCreatorOnReply),
    tenantTicketsPerHour: int(r.tenantTicketsPerHour, d.tenantTicketsPerHour, 1, 1000),
    tenantMessagesPerHour: int(r.tenantMessagesPerHour, d.tenantMessagesPerHour, 1, 5000),
    userTicketsPerHour: int(r.userTicketsPerHour, d.userTicketsPerHour, 1, 1000),
    userMessagesPerHour: int(r.userMessagesPerHour, d.userMessagesPerHour, 1, 5000),
  };
}

/** پیام جدید روی همان تیکت در بازه‌ی cooldown نباید دوباره اعلان بسازد. */
export function withinCooldown(lastAt: Date | null | undefined, now: Date, cooldownSec: number): boolean {
  if (!lastAt || cooldownSec <= 0) return false;
  return now.getTime() - lastAt.getTime() < cooldownSec * 1000;
}

export function smsAllowed(settings: Pick<TicketAlertSettings, 'sms' | 'smsDailyCap'>, sentToday: number): boolean {
  return settings.sms && sentToday < settings.smsDailyCap;
}

/** حذف نویسه‌های کنترلی/جهت‌دهی و لینک‌ها از متن دلخواه کاربر قبل از ورود به اعلان. */
export function sanitizeUserText(s: string): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/(https?:\/\/|www\.)\S+/gi, '[لینک]')
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(ir|com|net|org|io|me|ly|co)\b\S*/gi, '[لینک]');
}

export function clip(s: string, max: number): string {
  const t = sanitizeUserText(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export type TicketAlertKind = 'new' | 'reply';

export function ticketAlertText(kind: TicketAlertKind, p: { tenantName: string; subject: string; preview: string; ticketId: string }): { title: string; body: string; sms: string } {
  const title = kind === 'new' ? `تیکت پشتیبانی جدید — ${p.tenantName}` : `پیام جدید در تیکت — ${p.tenantName}`;
  const body = `${clip(p.subject, 80)}: ${clip(p.preview, 160)}`;
  // پیامک: فقط متن ثابت + شناسه‌ی تیکت؛ هیچ متن دلخواه کاربر (موضوع/نام تننت) داخل پیامک نمی‌رود
  const sms = `اکسیر ERP: ${kind === 'new' ? 'تیکت پشتیبانی جدید' : 'پیام جدید در تیکت'} ثبت شد. شناسه: ${p.ticketId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8)}`;
  return { title, body, sms };
}

export const TICKET_NOTIFY_TYPE = { abuse: 'platform.ticket.abuse', new: 'platform.ticket.new', reply: 'platform.ticket.reply', staffReply: 'support.ticket.staff_reply' } as const;

export function ticketLinkForStaff(ticketId: string): string {
  return `/platform?tab=tickets&ticket=${ticketId}`;
}
