import { BadRequestException } from '@nestjs/common';
import { toPersianDigits } from '../common/persian.js';

/**
 * قالب پیامک وضعیت پروژه — موتور خالص (بدون DB): فقط جایگزین‌شونده‌های فهرست سفید، هیچ ارزیابی/اجرای کدی.
 * قالب‌ها همیشه سمت سرور از تنظیمات ذخیره‌شده رندر می‌شوند؛ هرگز از ورودی مشتری.
 */

export const PLACEHOLDERS = ['name', 'project', 'stage', 'percent', 'done', 'total', 'link', 'company', 'phone'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export const MAX_TEMPLATE_LENGTH = 400;

export const SMS_EVENTS = ['stageStarted', 'stageCompleted', 'projectCompleted', 'projectOnHold', 'projectCancelled', 'projectResumed'] as const;
export type SmsEventKey = (typeof SMS_EVENTS)[number];

/** کد رویداد در ProjectSmsLog */
export const EVENT_LOG_CODE: Record<SmsEventKey, string> = {
  stageStarted: 'STAGE_STARTED',
  stageCompleted: 'STAGE_COMPLETED',
  projectCompleted: 'PROJECT_COMPLETED',
  projectOnHold: 'PROJECT_ON_HOLD',
  projectCancelled: 'PROJECT_CANCELLED',
  projectResumed: 'PROJECT_RESUMED',
};

export type ProjectSmsSettings = {
  enabled: boolean;
  maxPerProjectPerDay: number;
  maxPerTenantPerDay: number;
  events: Record<SmsEventKey, { enabled: boolean; template: string }>;
  manualTemplate: string;
};

export const DEFAULT_PROJECT_SMS: ProjectSmsSettings = {
  enabled: false,
  maxPerProjectPerDay: 5,
  maxPerTenantPerDay: 200,
  events: {
    stageStarted: { enabled: true, template: '{name} عزیز، مرحله «{stage}» پروژه «{project}» شروع شد.[[ مشاهده: {link}]]' },
    stageCompleted: { enabled: true, template: '{name} عزیز، مرحله «{stage}» پروژه «{project}» تکمیل شد. پیشرفت: {percent}٪.[[ مشاهده: {link}]]' },
    projectCompleted: { enabled: true, template: '{name} عزیز، پروژه «{project}» با موفقیت تکمیل شد. از اعتماد شما سپاسگزاریم.[[ مشاهده: {link}]]' },
    projectOnHold: { enabled: false, template: '{name} عزیز، پروژه «{project}» موقتاً متوقف شد.[[ مشاهده: {link}]]' },
    projectCancelled: { enabled: false, template: '{name} عزیز، پروژه «{project}» لغو شد.[[ جزئیات: {link}]]' },
    projectResumed: { enabled: false, template: '{name} عزیز، پروژه «{project}» دوباره از سر گرفته شد.[[ مشاهده: {link}]]' },
  },
  manualTemplate: '{name} عزیز، پیشرفت پروژه «{project}»: {percent}٪ ({done} از {total} مرحله).[[ مشاهده: {link}]]',
};

export const EVENT_LABELS: Record<SmsEventKey, string> = {
  stageStarted: 'شروع مرحله',
  stageCompleted: 'تکمیل مرحله',
  projectCompleted: 'تکمیل پروژه',
  projectOnHold: 'توقف پروژه',
  projectCancelled: 'لغو پروژه',
  projectResumed: 'از‌سرگیری پروژه',
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g;
const CONTROL_TEST = new RegExp(CONTROL_CHARS.source);
const HTML_LIKE = /<[^>]*>?/;
const PLACEHOLDER_TOKEN = /\{([a-zA-Z_]+)\}/g;

/** مقدار جایگزین: بدون HTML/کنترل/آکولاد/کروشه‌ی دوتایی (تا بازگشتی باز نشود)، فضای خالی فشرده و کوتاه‌شده. */
export function sanitizeValue(v: unknown, max: number): string {
  if (v === null || v === undefined) return '';
  const s = String(v)
    .replace(/<[^>]*>?/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/[{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type SmsVars = Partial<Record<Placeholder, string | number | null | undefined>>;

const VALUE_MAX: Record<Placeholder, number> = { name: 40, project: 60, stage: 60, percent: 5, done: 5, total: 5, link: 300, company: 40, phone: 20 };

/** برچسب‌هایی که اگر {link} خالی باشد و در انتهای پیام بمانند، حذف می‌شوند (قالب‌های بدون بلوک [[ ]]). */
const DANGLING_LABEL = /(?:\s*[-–—|،,]?\s*(?:مشاهده(?:\s*و\s*پیگیری)?|پیگیری|جزئیات|لینک(?:\s*پیگیری)?|مشاهده\s*وضعیت)\s*[:：]?)\s*$/u;

export function renderProjectSms(template: string, input: SmsVars): string {
  const vals = {} as Record<Placeholder, string>;
  for (const k of PLACEHOLDERS) {
    const raw = input[k];
    const isNum = k === 'percent' || k === 'done' || k === 'total';
    vals[k] = k === 'link' ? sanitizeLink(raw) : isNum && raw !== '' && raw !== null && raw !== undefined ? toPersianDigits(Math.max(0, Math.round(Number(raw)) || 0)) : sanitizeValue(raw, VALUE_MAX[k]);
  }
  const linkEmpty = vals.link === '';
  const clean = String(template ?? '').replace(CONTROL_CHARS, '').replace(/\r/g, '');

  const fill = (text: string): { out: string; empty: boolean } => {
    let empty = false;
    const out = text.replace(PLACEHOLDER_TOKEN, (_m, name: string) => {
      if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
        empty = true; // جایگزین‌شونده‌ی ناشناخته حذف می‌شود
        return '';
      }
      const v = vals[name as Placeholder];
      if (v === '') empty = true;
      return v;
    });
    return { out, empty };
  };

  // بلوک‌های اختیاری [[ ... ]]: اگر هر جایگزین‌شونده‌ی داخلش خالی باشد کل بلوک حذف می‌شود
  const parts = clean.split(/\[\[([^[\]]*)\]\]/);
  let result = '';
  parts.forEach((seg, i) => {
    if (i % 2 === 0) result += fill(seg).out;
    else {
      const r = fill(seg);
      if (!r.empty) result += r.out;
    }
  });
  result = result.replace(/\[\[|\]\]/g, '');

  if (linkEmpty) result = result.replace(DANGLING_LABEL, '');
  return result
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([.،!؟])/g, '$1')
    .trim();
}

/** فقط http(s) و بدون فاصله/کنترل؛ هر چیز دیگر = خالی. */
function sanitizeLink(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^https?:\/\/[^\s<>"'{}]{1,290}$/.test(s)) return '';
  return s;
}

// ── اعتبارسنجی تنظیمات ──────────────────────────────────────────────────

export function validateTemplate(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new BadRequestException(`متن «${label}» باید رشته باشد`);
  if (value.length > MAX_TEMPLATE_LENGTH) throw new BadRequestException(`متن «${label}» حداکثر ${MAX_TEMPLATE_LENGTH} نویسه است`);
  if (HTML_LIKE.test(value)) throw new BadRequestException(`متن «${label}» نباید شامل HTML باشد`);
  if (CONTROL_TEST.test(value)) throw new BadRequestException(`متن «${label}» شامل نویسه‌ی غیرمجاز است`);
  if (!value.trim()) throw new BadRequestException(`متن «${label}» خالی است`);
  for (const m of value.matchAll(PLACEHOLDER_TOKEN)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) throw new BadRequestException(`در «${label}» جایگزین‌شونده‌ی ناشناخته {${m[1]}} به کار رفته است`);
  }
  return value.trim();
}

function validInt(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${label} باید عددی صحیح بین ${min} و ${max} باشد`);
  return v;
}

/** ورودی ذخیره‌ی تنظیمات → ساختار تمیز. مقدارهای حذف‌شده از پیش‌فرض/مقدار قبلی پر می‌شوند. */
export function parseSettingsInput(input: unknown, base: ProjectSmsSettings = DEFAULT_PROJECT_SMS): ProjectSmsSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('داده‌ی تنظیمات نامعتبر است');
  const o = input as Record<string, unknown>;
  const out: ProjectSmsSettings = JSON.parse(JSON.stringify(base));
  if (o.enabled !== undefined) {
    if (typeof o.enabled !== 'boolean') throw new BadRequestException('وضعیت فعال‌سازی نامعتبر است');
    out.enabled = o.enabled;
  }
  if (o.maxPerProjectPerDay !== undefined) out.maxPerProjectPerDay = validInt(o.maxPerProjectPerDay, 'سقف روزانه‌ی هر پروژه', 1, 50);
  if (o.maxPerTenantPerDay !== undefined) out.maxPerTenantPerDay = validInt(o.maxPerTenantPerDay, 'سقف روزانه‌ی کل', 1, 5000);
  if (o.manualTemplate !== undefined) out.manualTemplate = validateTemplate(o.manualTemplate, 'ارسال وضعیت پروژه');
  if (o.events !== undefined) {
    if (!o.events || typeof o.events !== 'object' || Array.isArray(o.events)) throw new BadRequestException('رویدادها نامعتبر است');
    const ev = o.events as Record<string, unknown>;
    for (const key of Object.keys(ev)) if (!(SMS_EVENTS as readonly string[]).includes(key)) throw new BadRequestException('رویداد ناشناخته');
    for (const key of SMS_EVENTS) {
      const e = ev[key];
      if (e === undefined) continue;
      if (!e || typeof e !== 'object' || Array.isArray(e)) throw new BadRequestException('رویداد نامعتبر است');
      const eo = e as Record<string, unknown>;
      if (eo.enabled !== undefined) {
        if (typeof eo.enabled !== 'boolean') throw new BadRequestException('وضعیت رویداد نامعتبر است');
        out.events[key].enabled = eo.enabled;
      }
      if (eo.template !== undefined) out.events[key].template = validateTemplate(eo.template, EVENT_LABELS[key]);
    }
  }
  return out;
}

/** مقدار ذخیره‌شده (احتمالاً قدیمی/خراب) → تنظیمات معتبر؛ هر بخش نامعتبر به پیش‌فرض برمی‌گردد. */
export function mergeStoredSettings(stored: unknown): ProjectSmsSettings {
  const out: ProjectSmsSettings = JSON.parse(JSON.stringify(DEFAULT_PROJECT_SMS));
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  const o = stored as Record<string, unknown>;
  const tryTpl = (v: unknown): string | null => {
    try {
      return validateTemplate(v, 'قالب');
    } catch {
      return null;
    }
  };
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled;
  if (typeof o.maxPerProjectPerDay === 'number' && o.maxPerProjectPerDay >= 1 && o.maxPerProjectPerDay <= 50) out.maxPerProjectPerDay = Math.floor(o.maxPerProjectPerDay);
  if (typeof o.maxPerTenantPerDay === 'number' && o.maxPerTenantPerDay >= 1 && o.maxPerTenantPerDay <= 5000) out.maxPerTenantPerDay = Math.floor(o.maxPerTenantPerDay);
  const mt = tryTpl(o.manualTemplate);
  if (mt) out.manualTemplate = mt;
  if (o.events && typeof o.events === 'object') {
    const ev = o.events as Record<string, { enabled?: unknown; template?: unknown } | undefined>;
    for (const key of SMS_EVENTS) {
      const e = ev[key];
      if (!e || typeof e !== 'object') continue;
      if (typeof e.enabled === 'boolean') out.events[key].enabled = e.enabled;
      const t = tryTpl(e.template);
      if (t) out.events[key].template = t;
    }
  }
  return out;
}

/** مقادیر نمونه برای پیش‌نمایش زنده */
export const SAMPLE_VARS: Required<Record<Placeholder, string | number>> = {
  name: 'آقای احمدی',
  project: 'بازسازی دفتر مرکزی',
  stage: 'نصب تجهیزات',
  percent: 60,
  done: 3,
  total: 5,
  link: 'https://example.com/project/t0123456789a/xxxxxxxx',
  company: 'شرکت نمونه',
  phone: '02112345678',
};
