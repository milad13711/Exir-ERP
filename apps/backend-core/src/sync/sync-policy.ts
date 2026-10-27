import { BadRequestException } from '@nestjs/common';

/** کلیدهای عملیات آفلاین‌پذیر — باید با web-panel/src/lib/offline/registry.ts یکی باشد (تست parity). */
export const OFFLINE_OPERATION_KEYS = [
  'hr.attendance.mark',
  'checklist.create',
  'checklist.update',
  'checklist.toggle',
  'tasks.create',
  'tasks.update',
  'tasks.start',
  'tasks.result',
  'tasks.comment',
  'crm.contact.create',
  'crm.contact.update',
  'crm.activity.add',
  'reminders.create',
  'reminders.update',
  'reminders.done',
  'sales.invoice.draft.create',
  'sales.invoice.draft.update',
  'sales.quotation.create',
  'sales.quotation.update',
  'booking.appointment.create',
  'correspondence.incoming.register',
  'projects.note.add',
] as const;

export type OfflinePolicy = {
  /** پیش‌فرض: همه‌ی کلیدهای رجیستری روشن. */
  enabledOperations: string[];
  maxOfflineDays: number;
  /** نقش‌های تننت که مجاز به کار آفلاین‌اند (خالی = همه). */
  allowedRoles: string[];
  /** پیش‌فرض true: هنگام خروج، داده و کلید آفلاین پاک می‌شود (نگه‌داشتن فقط با انتخاب صریح کاربر در پنجره‌ی خروج). */
  wipeOnLogout: boolean;
  /** اگر true، OWNER/ADMIN می‌توانند مورد قدیمی‌تر از maxOfflineDays را با پرچم بازبینی صریح ارسال کنند. */
  allowReviewedBeyondMax: boolean;
  maxAttachmentMb: number;
  /** سقف کل فایل‌های صف‌شده روی دستگاه */
  maxQueueMb: number;
};

export const POLICY_MODULE_CODE = 'offline-sync';
export const POLICY_KEY = 'policy';
const ROLES = ['OWNER', 'ADMIN', 'MEMBER'];

export function defaultPolicy(): OfflinePolicy {
  return {
    enabledOperations: [...OFFLINE_OPERATION_KEYS],
    maxOfflineDays: 7,
    allowedRoles: [],
    wipeOnLogout: true,
    allowReviewedBeyondMax: false,
    maxAttachmentMb: 25,
    maxQueueMb: 150,
  };
}

function int(v: unknown, min: number, max: number, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new BadRequestException(`مقدار «${field}» باید عدد صحیح بین ${min} و ${max} باشد`);
  }
  return v;
}

/** اعتبارسنجی ورودی سیاست (PUT) — فیلدهای ناشناخته رد می‌شود. */
export function validatePolicyInput(input: unknown): OfflinePolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('بدنه‌ی سیاست نامعتبر است');
  const o = input as Record<string, unknown>;
  const allowed = new Set(['enabledOperations', 'maxOfflineDays', 'allowedRoles', 'wipeOnLogout', 'allowReviewedBeyondMax', 'maxAttachmentMb', 'maxQueueMb']);
  for (const k of Object.keys(o)) if (!allowed.has(k)) throw new BadRequestException(`فیلد ناشناخته: ${k}`);
  const base = defaultPolicy();
  const out: OfflinePolicy = { ...base };
  if (o.enabledOperations !== undefined) {
    if (!Array.isArray(o.enabledOperations) || o.enabledOperations.length > 100) throw new BadRequestException('فهرست عملیات نامعتبر است');
    const known = new Set<string>(OFFLINE_OPERATION_KEYS);
    for (const k of o.enabledOperations) if (typeof k !== 'string' || !known.has(k)) throw new BadRequestException('عملیات ناشناخته در فهرست است');
    out.enabledOperations = [...new Set(o.enabledOperations as string[])];
  }
  if (o.maxOfflineDays !== undefined) out.maxOfflineDays = int(o.maxOfflineDays, 1, 60, 'حداکثر روز آفلاین');
  if (o.maxAttachmentMb !== undefined) out.maxAttachmentMb = int(o.maxAttachmentMb, 1, 50, 'حداکثر حجم فایل');
  if (o.maxQueueMb !== undefined) out.maxQueueMb = int(o.maxQueueMb, 10, 500, 'حداکثر حجم صف');
  if (o.wipeOnLogout !== undefined) {
    if (typeof o.wipeOnLogout !== 'boolean') throw new BadRequestException('گزینه‌ی پاک‌سازی هنگام خروج نامعتبر است');
    out.wipeOnLogout = o.wipeOnLogout;
  }
  if (o.allowReviewedBeyondMax !== undefined) {
    if (typeof o.allowReviewedBeyondMax !== 'boolean') throw new BadRequestException('گزینه‌ی بازبینی موارد قدیمی نامعتبر است');
    out.allowReviewedBeyondMax = o.allowReviewedBeyondMax;
  }
  if (o.allowedRoles !== undefined) {
    if (!Array.isArray(o.allowedRoles) || o.allowedRoles.length > 20) throw new BadRequestException('فهرست نقش‌ها نامعتبر است');
    for (const r of o.allowedRoles) if (typeof r !== 'string' || !ROLES.includes(r)) throw new BadRequestException('نقش ناشناخته در فهرست است');
    out.allowedRoles = [...new Set(o.allowedRoles as string[])];
  }
  return out;
}

/** سیاست ذخیره‌شده را با پیش‌فرض ادغام می‌کند (مقادیر خراب نادیده گرفته می‌شود). */
export function mergeStoredPolicy(stored: unknown): OfflinePolicy {
  const base = defaultPolicy();
  if (!stored || typeof stored !== 'object') return base;
  try {
    return { ...base, ...validatePolicyInput(stored) };
  } catch {
    return base;
  }
}

export function roleAllowed(policy: OfflinePolicy, role: string): boolean {
  return policy.allowedRoles.length === 0 || policy.allowedRoles.includes(role);
}
