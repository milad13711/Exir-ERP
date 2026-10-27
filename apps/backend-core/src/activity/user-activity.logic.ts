import { BadRequestException } from '@nestjs/common';
import { toGregorian } from '../common/jalali.js';
import { MODULE_LABELS } from './activity-route.util.js';
import { maskIp } from './activity-redact.util.js';

/**
 * منطق خالص «آرشیو فعالیت کاربر»: نرمال‌سازی چند منبع رویداد به یک جریان زمانی واحد، ادغام با cursor، حذف تکرار،
 * فیلتر تاریخ جلالی، خلاصه‌ی دستگاه و CSV امن. هیچ دسترسی به DB یا مجوز اینجا نیست (در سرویس‌ها).
 * قاعده‌ی حریم: هرگز بدنه‌ی رکورد (metadata/before/after/note) خارج نمی‌شود؛ فقط برچسب، ارجاع موجودیت و زمان.
 */

export type TimelineSource = 'activity' | 'task' | 'correspondence' | 'dispatch' | 'document' | 'signature' | 'offboarding';
export type TimelineActor = 'MANUAL' | 'AUTOMATIC' | 'SYSTEM';

export type TimelineItem = {
  /** `${source}:${rawId}` — یکتا و پایدار برای cursor */
  id: string;
  /** ISO UTC */
  at: string;
  source: TimelineSource;
  moduleCode: string;
  moduleLabel: string;
  actionType: string;
  title: string;
  entityType: string | null;
  entityId: string | null;
  actorType: TimelineActor;
  /** فقط برای مدیر/خود کاربر پر می‌شود (در سرویس) */
  ip?: string | null;
  device?: string | null;
  /** مسیر پنل — فقط اگر بیننده دسترسی دارد (در سرویس) */
  link?: string | null;
};

export const ACTION_TYPES = ['create', 'update', 'delete', 'login', 'approve', 'reject', 'cancel', 'send', 'status', 'sign', 'other'] as const;
export type TimelineActionType = (typeof ACTION_TYPES)[number];

export const ACTION_TYPE_LABELS: Record<string, string> = {
  create: 'ایجاد', update: 'ویرایش', delete: 'حذف', login: 'ورود', approve: 'تأیید', reject: 'رد', cancel: 'لغو', send: 'ارسال', status: 'تغییر وضعیت', sign: 'امضا', other: 'سایر',
};

const EXTRA_MODULE_LABELS: Record<string, string> = { auth: 'ورود و امنیت', signature: 'امضای دیجیتال', users: 'کاربران و نقش‌ها' };
export const moduleLabel = (code: string): string => MODULE_LABELS[code] ?? EXTRA_MODULE_LABELS[code] ?? code;

// ── برچسب رویدادهای هر منبع ─────────────────────────────────────────────

type Lab = { label: string; actionType: TimelineActionType };

/** رویدادهای نویزی که در آرشیو نمی‌آیند (تحویل خودکار وظیفه، رویدادهای سیستمی مکاتبات). */
export const TASK_EVENT_EXCLUDED = ['delivered'] as const;
export const TASK_EVENT_LABELS: Record<string, Lab> = {
  created: { label: 'ایجاد وظیفه', actionType: 'create' },
  sent: { label: 'ارسال وظیفه', actionType: 'send' },
  scheduled: { label: 'زمان‌بندی ارسال وظیفه', actionType: 'create' },
  viewed: { label: 'مشاهده‌ی وظیفه', actionType: 'other' },
  started: { label: 'شروع وظیفه', actionType: 'status' },
  resumed: { label: 'ادامه‌ی وظیفه', actionType: 'status' },
  result_submitted: { label: 'ثبت نتیجه‌ی وظیفه', actionType: 'status' },
  approved: { label: 'تأیید وظیفه', actionType: 'approve' },
  returned: { label: 'بازگرداندن وظیفه برای اصلاح', actionType: 'reject' },
  reassigned: { label: 'ارجاع مجدد وظیفه', actionType: 'update' },
  cancelled: { label: 'لغو وظیفه', actionType: 'cancel' },
  reopened: { label: 'بازگشایی وظیفه', actionType: 'status' },
  problem_reported: { label: 'گزارش مشکل در وظیفه', actionType: 'other' },
  edited: { label: 'ویرایش وظیفه', actionType: 'update' },
  deadline_changed: { label: 'تغییر موعد وظیفه', actionType: 'update' },
  extension_requested: { label: 'درخواست تمدید وظیفه', actionType: 'other' },
  extension_approved: { label: 'تأیید تمدید وظیفه', actionType: 'approve' },
  extension_rejected: { label: 'رد تمدید وظیفه', actionType: 'reject' },
};

export const CORR_EVENT_EXCLUDED = ['EVIDENCE_PENDING', 'REMINDER', 'NOTE'] as const;
export const CORR_EVENT_LABELS: Record<string, Lab> = {
  CREATED: { label: 'ایجاد نامه', actionType: 'create' },
  EDITED: { label: 'ویرایش نامه', actionType: 'update' },
  SUBMITTED: { label: 'ارسال نامه برای بررسی', actionType: 'send' },
  REVIEWED: { label: 'بررسی نامه', actionType: 'approve' },
  RETURNED: { label: 'بازگرداندن نامه', actionType: 'reject' },
  REJECTED: { label: 'رد نامه', actionType: 'reject' },
  PARAPHED: { label: 'پاراف نامه', actionType: 'sign' },
  SIGNED: { label: 'امضای نامه', actionType: 'sign' },
  ISSUED: { label: 'صدور نامه', actionType: 'status' },
  SENT: { label: 'ارسال نامه', actionType: 'send' },
  DELIVERED: { label: 'تحویل نامه', actionType: 'status' },
  REGISTERED: { label: 'ثبت نامه‌ی وارده', actionType: 'create' },
  REFERRED: { label: 'ارجاع نامه', actionType: 'send' },
  REFERRAL_SEEN: { label: 'مشاهده‌ی ارجاع نامه', actionType: 'other' },
  REFERRAL_DONE: { label: 'انجام ارجاع نامه', actionType: 'status' },
  REFERRAL_FORWARDED: { label: 'ارجاع مجدد نامه', actionType: 'send' },
  REFERRAL_RETURNED: { label: 'بازگرداندن ارجاع نامه', actionType: 'reject' },
  REFERRAL_CANCELLED: { label: 'لغو ارجاع نامه', actionType: 'cancel' },
  REPLIED: { label: 'پاسخ به نامه', actionType: 'send' },
  ANSWERED: { label: 'ثبت پاسخ نامه', actionType: 'status' },
  CLOSED: { label: 'بستن نامه', actionType: 'status' },
  REOPENED: { label: 'بازگشایی نامه', actionType: 'status' },
  ARCHIVED: { label: 'بایگانی نامه', actionType: 'status' },
  UNARCHIVED: { label: 'خروج نامه از بایگانی', actionType: 'status' },
  VOID_REQUESTED: { label: 'درخواست ابطال نامه', actionType: 'cancel' },
  VOIDED: { label: 'ابطال نامه', actionType: 'cancel' },
  CORRECTION_CREATED: { label: 'ایجاد اصلاحیه‌ی نامه', actionType: 'create' },
  RECEIPT_RECEIVED: { label: 'ثبت رسید نامه', actionType: 'status' },
  EXTERNAL_FOLLOWUP: { label: 'پیگیری بیرونی نامه', actionType: 'other' },
};

const SHIPMENT_FALLBACK: Lab = { label: 'اقدام روی محموله', actionType: 'other' };

export function labelForTaskEvent(type: string): Lab {
  return TASK_EVENT_LABELS[type] ?? { label: 'اقدام روی وظیفه', actionType: 'other' };
}
export function labelForCorrEvent(type: string): Lab {
  return CORR_EVENT_LABELS[type] ?? { label: 'اقدام روی نامه', actionType: 'other' };
}

/** رویدادهای هر منبع که با یک actionType هم‌خوانند (برای where در DB). */
export function eventTypesForAction(labels: Record<string, Lab>, actionType: string): string[] {
  return Object.entries(labels).filter(([, l]) => l.actionType === actionType).map(([k]) => k);
}

/** ماژولی که هر entityType از DocumentRevision به آن تعلق دارد. */
export function moduleOfRevision(entityType: string): string {
  if (entityType.startsWith('sales_')) return 'sales';
  if (entityType.startsWith('stock_')) return 'warehouse';
  return 'dashboard';
}
export const REVISION_ENTITY_TYPES_BY_MODULE: Record<string, string[]> = {
  sales: ['sales_invoice', 'sales_quotation'],
  warehouse: ['stock_movement', 'stock_import_batch'],
};

// ── نگاشت ردیف‌های خام ← TimelineItem (فقط فیلدهای مجاز) ─────────────────

const iso = (d: Date) => d.toISOString();
const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type RawActivity = {
  id: string; action: string; actorType: string; moduleCode: string | null; actionType: string | null; summary: string | null;
  entityType: string; entityId: string | null; ip: string | null; createdAt: Date;
};
export function mapActivity(r: RawActivity): TimelineItem {
  const mod = r.moduleCode ?? r.action.split('.')[0] ?? 'system';
  return {
    id: `activity:${r.id}`,
    at: iso(r.createdAt),
    source: 'activity',
    moduleCode: mod,
    moduleLabel: moduleLabel(mod),
    actionType: r.actionType ?? 'other',
    title: clip(r.summary ?? r.action),
    entityType: r.entityType,
    entityId: r.entityId,
    actorType: (['MANUAL', 'AUTOMATIC', 'SYSTEM'].includes(r.actorType) ? r.actorType : 'MANUAL') as TimelineActor,
    ip: r.ip,
  };
}

export function mapTaskEvent(r: { id: string; taskId: string; type: string; createdAt: Date }): TimelineItem {
  const lab = labelForTaskEvent(r.type);
  return { id: `task:${r.id}`, at: iso(r.createdAt), source: 'task', moduleCode: 'tasks', moduleLabel: moduleLabel('tasks'), actionType: lab.actionType, title: lab.label, entityType: 'Task', entityId: r.taskId, actorType: 'MANUAL' };
}

export function mapCorrEvent(r: { id: string; letterId: string; type: string; createdAt: Date }): TimelineItem {
  const lab = labelForCorrEvent(r.type);
  return { id: `correspondence:${r.id}`, at: iso(r.createdAt), source: 'correspondence', moduleCode: 'correspondence', moduleLabel: moduleLabel('correspondence'), actionType: lab.actionType, title: lab.label, entityType: 'CorrLetter', entityId: r.letterId, actorType: 'MANUAL' };
}

export function mapShipmentEvent(r: { id: string; shipmentId: string; type: string; toStatus: string | null; createdAt: Date }): TimelineItem {
  return { id: `dispatch:${r.id}`, at: iso(r.createdAt), source: 'dispatch', moduleCode: 'dispatch', moduleLabel: moduleLabel('dispatch'), actionType: SHIPMENT_FALLBACK.actionType, title: SHIPMENT_FALLBACK.label, entityType: 'Shipment', entityId: r.shipmentId, actorType: 'MANUAL' };
}

export function mapRevision(r: { id: string; entityType: string; entityId: string; revisionNo: number; action: string; createdAt: Date }): TimelineItem {
  const mod = moduleOfRevision(r.entityType);
  const void_ = r.action === 'VOID';
  return {
    id: `document:${r.id}`, at: iso(r.createdAt), source: 'document', moduleCode: mod, moduleLabel: moduleLabel(mod),
    actionType: void_ ? 'cancel' : 'update', title: void_ ? `ابطال سند (نسخه‌ی ${r.revisionNo})` : `ویرایش سند (نسخه‌ی ${r.revisionNo})`,
    entityType: r.entityType, entityId: r.entityId, actorType: 'MANUAL',
  };
}

export function mapSignature(r: { id: string; entityType: string; entityId: string; action: string; ip: string | null; createdAt: Date }): TimelineItem {
  return {
    id: `signature:${r.id}`, at: iso(r.createdAt), source: 'signature', moduleCode: 'signature', moduleLabel: moduleLabel('signature'),
    actionType: 'sign', title: 'ثبت امضای دیجیتال با مدرک (IP و دستگاه)', entityType: r.entityType, entityId: r.entityId, actorType: 'MANUAL', ip: maskIp(r.ip),
  };
}

export function mapOffboarding(r: { id: string; mode: string; fromUserId: string; toUserId: string | null; fromUserName: string; toUserName: string | null; createdAt: Date }, subjectId: string): TimelineItem {
  const asSource = r.fromUserId === subjectId;
  const modeFa = r.mode === 'delete' ? 'حذف' : r.mode === 'deactivate' ? 'غیرفعال‌سازی' : 'انتقال مسئولیت';
  const title = asSource
    ? `${modeFa} کاربر${r.toUserName ? ` و انتقال رکوردها به «${r.toUserName}»` : ''}`
    : `دریافت رکوردهای منتقل‌شده از «${r.fromUserName}»`;
  return { id: `offboarding:${r.id}:${asSource ? 'from' : 'to'}`, at: iso(r.createdAt), source: 'offboarding', moduleCode: 'users', moduleLabel: moduleLabel('users'), actionType: asSource ? 'status' : 'other', title, entityType: 'UserOffboardingRun', entityId: r.id, actorType: 'MANUAL' };
}

// ── cursor و ادغام ───────────────────────────────────────────────────────

export type Cursor = { at: number; id: string };
export function encodeCursor(item: Pick<TimelineItem, 'at' | 'id'>): string {
  return Buffer.from(`${new Date(item.at).getTime()}|${item.id}`).toString('base64url');
}
export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null;
  try {
    const s = Buffer.from(raw, 'base64url').toString('utf8');
    const i = s.indexOf('|');
    const at = Number(s.slice(0, i));
    const id = s.slice(i + 1);
    if (!Number.isFinite(at) || i < 1 || !id || id.length > 120) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** ترتیب نزولی (زمان، شناسه) — کلید پایدار برای cursor. */
export function compareDesc(a: Pick<TimelineItem, 'at' | 'id'>, b: Pick<TimelineItem, 'at' | 'id'>): number {
  const d = new Date(b.at).getTime() - new Date(a.at).getTime();
  if (d !== 0) return d;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
export const isBeforeCursor = (item: Pick<TimelineItem, 'at' | 'id'>, c: Cursor): boolean => {
  const t = new Date(item.at).getTime();
  return t < c.at || (t === c.at && item.id < c.id);
};

/**
 * وظیفه‌ای که هم TaskEvent دارد هم ردیف ActivityLog (لاگ HTTP) → ردیف لاگ حذف می‌شود
 * (رویداد وظیفه غنی‌تر است). همان موجودیت و ماژول، حداکثر ۵ ثانیه فاصله.
 */
export function dedupeNearDuplicates(items: TimelineItem[], windowMs = 5_000): TimelineItem[] {
  const rich = items.filter((i) => i.source === 'task' || i.source === 'correspondence' || i.source === 'dispatch');
  if (rich.length === 0) return items;
  return items.filter((i) => {
    if (i.source !== 'activity' || !i.entityId) return true;
    const t = new Date(i.at).getTime();
    return !rich.some((r) => r.moduleCode === i.moduleCode && r.entityId === i.entityId && Math.abs(new Date(r.at).getTime() - t) <= windowMs);
  });
}

/**
 * ادغام k فهرست مرتب‌نشده (هر کدام حداکثر sourceLimit ردیف تازه‌تر از cursor) در یک صفحه‌ی `limit`تایی.
 * `anySourceFull` = حداقل یک منبع به سقف خودش رسیده (پس شاید ردیف بیشتری هست).
 */
export function mergeTimelines(
  lists: TimelineItem[][],
  opts: { limit: number; cursor?: Cursor | null; anySourceFull?: boolean },
): { items: TimelineItem[]; nextCursor: string | null } {
  let flat = lists.flat();
  if (opts.cursor) flat = flat.filter((i) => isBeforeCursor(i, opts.cursor!));
  flat = dedupeNearDuplicates(flat.sort(compareDesc)).sort(compareDesc);
  const items = flat.slice(0, opts.limit);
  const more = flat.length > opts.limit || (opts.anySourceFull === true && items.length > 0);
  return { items, nextCursor: more && items.length ? encodeCursor(items[items.length - 1]) : null };
}

// ── فیلترها: تاریخ جلالی/میلادی ← UTC ───────────────────────────────────

const TEHRAN_OFFSET = '+03:30';

/** `YYYY-MM-DD` میلادی یا جلالی (سال < ۱۷۰۰) → بازه‌ی UTC روز تهران؛ `end` تا انتهای همان روز. */
export function parseDayParam(v: string | undefined, end: boolean): Date | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v.trim());
  if (!m) throw new BadRequestException('تاریخ نامعتبر است');
  let [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new BadRequestException('تاریخ نامعتبر است');
  if (y < 1700) {
    const g = toGregorian(y, mo, d);
    [y, mo, d] = [g.getFullYear(), g.getMonth() + 1, g.getDate()];
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = new Date(`${y}-${pad(mo)}-${pad(d)}T00:00:00${TEHRAN_OFFSET}`);
  if (Number.isNaN(start.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
  return end ? new Date(start.getTime() + 86_400_000 - 1) : start;
}

export type TimelineFilters = {
  module?: string;
  actionType?: string;
  from?: Date;
  to?: Date;
  q?: string;
  entityType?: string;
  entityId?: string;
};

export function parseTimelineFilters(q: Record<string, string | undefined>): TimelineFilters {
  const actionType = q.actionType?.trim();
  if (actionType && !(ACTION_TYPES as readonly string[]).includes(actionType)) throw new BadRequestException('نوع اقدام نامعتبر است');
  const safeId = (v?: string) => (v && /^[0-9A-Za-z_.:-]{1,80}$/.test(v) ? v : undefined);
  const from = parseDayParam(q.from, false);
  const to = parseDayParam(q.to, true);
  if (from && to && from > to) throw new BadRequestException('بازه‌ی تاریخ نامعتبر است');
  return {
    module: safeId(q.module),
    actionType: actionType || undefined,
    from,
    to,
    q: q.q?.trim().slice(0, 100) || undefined,
    entityType: safeId(q.entityType),
    entityId: safeId(q.entityId),
  };
}

// ── دستگاه (خلاصه‌ی User-Agent، بدون ذخیره‌ی UA خام) ──────────────────────

export function summarizeDevice(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'مرورگر';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'نامشخص';
  return `${browser} · ${os}`;
}

// ── CSV امن ──────────────────────────────────────────────────────────────

/** خنثی‌سازی فرمول (= + - @ tab CR) و نقل‌قول‌گذاری استاندارد. */
export function csvCellSafe(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const TIMELINE_CSV_HEADER = ['زمان (تهران)', 'ماژول', 'نوع اقدام', 'شرح', 'نوع موجودیت', 'شناسه موجودیت', 'منبع', 'IP (ماسک‌شده)'];

export function tehranStamp(iso_: string): string {
  return new Date(new Date(iso_).getTime() + 12_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

export function buildTimelineCsv(items: TimelineItem[], opts: { includeNetwork: boolean }): string {
  const header = opts.includeNetwork ? TIMELINE_CSV_HEADER : TIMELINE_CSV_HEADER.slice(0, -1);
  const lines = [header.map(csvCellSafe).join(',')];
  for (const i of items) {
    const row = [tehranStamp(i.at), i.moduleLabel, ACTION_TYPE_LABELS[i.actionType] ?? i.actionType, i.title, i.entityType ?? '', i.entityId ?? '', i.source];
    if (opts.includeNetwork) row.push(i.ip ?? '');
    lines.push(row.map(csvCellSafe).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ── سیاست نگهداشت ────────────────────────────────────────────────────────

export const RETENTION_MODULE = 'activity';
export const RETENTION_KEY = 'retentionDays';
export const RETENTION_OPTIONS = [0, 365, 730, 1095, 1825] as const;

/** مقدار تنظیم → روز؛ null = برای همیشه نگه‌دار (پیش‌فرض). کمتر از ۳۰ روز مجاز نیست. */
export function parseRetentionDays(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(30, Math.floor(n));
}

/** ردیف‌های بدون کاربر (خودکار/سیستمی) همچنان پس از این تعداد روز پاک می‌شوند تا جدول بی‌انتها رشد نکند. */
export function systemRowsRetentionDays(env: string | undefined = process.env.ACTIVITY_LOG_RETENTION_DAYS): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
}
