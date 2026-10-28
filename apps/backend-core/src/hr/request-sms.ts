/**
 * پیامک اطلاع‌رسانی تصمیم درخواست‌های منابع انسانی به درخواست‌کننده — بخش خالص (بدون Prisma/Nest):
 * تنظیمات، موتور جانشین امن (whitelist + پاک‌سازی)، تشخیص شماره و پاک‌سازی متن.
 * هیچ مبلغ/حقوقی در پیامک نمی‌آید؛ برای وام/مساعده فقط نتیجه («تأیید/رد شد») مجاز است.
 */

export const HR_SMS_PLACEHOLDERS = ['employeeName', 'requestType', 'decision', 'fromDate', 'toDate', 'approverName', 'note', 'orgName'] as const;
export type HrSmsPlaceholder = (typeof HR_SMS_PLACEHOLDERS)[number];
export type HrSmsContext = Partial<Record<HrSmsPlaceholder, string | null | undefined>>;

export const HR_SMS_PLACEHOLDER_LABELS: Record<HrSmsPlaceholder, string> = {
  employeeName: 'نام درخواست‌کننده',
  requestType: 'نوع درخواست',
  decision: 'نتیجه',
  fromDate: 'از تاریخ',
  toDate: 'تا تاریخ',
  approverName: 'نام تصمیم‌گیرنده',
  note: 'توضیح (دلیل رد)',
  orgName: 'نام سازمان',
};

export const HR_REQUEST_TYPES = ['LEAVE_REQUEST'] as const;
export type HrRequestType = (typeof HR_REQUEST_TYPES)[number];
export const HR_REQUEST_TYPE_LABELS: Record<HrRequestType, string> = { LEAVE_REQUEST: 'مرخصی' };

export const HR_SMS_EVENTS = ['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type HrSmsEvent = (typeof HR_SMS_EVENTS)[number];
export const HR_SMS_EVENT_LABELS: Record<HrSmsEvent, string> = {
  SUBMITTED: 'ثبت و ارسال برای مدیر',
  APPROVED: 'تأیید',
  REJECTED: 'رد',
  CANCELLED: 'لغو/حذف',
};
export const HR_SMS_DECISION_LABELS: Record<HrSmsEvent, string> = {
  SUBMITTED: 'ثبت شد و برای مدیر ارسال شد',
  APPROVED: 'تأیید شد',
  REJECTED: 'رد شد',
  CANCELLED: 'لغو شد',
};

export type HrRequestSmsSettings = {
  /** کلید کلی */
  enabled: boolean;
  /** کلید هر رویداد (پیش‌فرض: فقط تأیید/رد روشن) */
  events: Record<HrSmsEvent, boolean>;
  /** کلید هر نوع درخواست (پیش‌فرض: مرخصی روشن) */
  types: Record<HrRequestType, boolean>;
  /** قالب هر رویداد؛ خالی ⇒ قالب پیش‌فرض */
  templates: Record<HrSmsEvent, string>;
  /** سقف پیامک روزانه‌ی کل تننت برای این قابلیت */
  dailyCap: number;
};

export const HR_SMS_DEFAULT_TEMPLATES: Record<HrSmsEvent, string> = {
  SUBMITTED: '{{employeeName}} عزیز، درخواست {{requestType}} شما از {{fromDate}} تا {{toDate}} ثبت شد و برای مدیر ارسال شد. {{orgName}}',
  APPROVED: '{{employeeName}} عزیز، درخواست {{requestType}} شما از {{fromDate}} تا {{toDate}} {{decision}}. {{orgName}}',
  REJECTED: '{{employeeName}} عزیز، درخواست {{requestType}} شما از {{fromDate}} تا {{toDate}} {{decision}}. {{note}} {{orgName}}',
  CANCELLED: '{{employeeName}} عزیز، درخواست {{requestType}} شما از {{fromDate}} تا {{toDate}} {{decision}}. {{orgName}}',
};

export const HR_SMS_DAILY_CAP_DEFAULT = 200;
export const HR_SMS_DAILY_CAP_MAX = 2000;
/** سقف پیامک اطلاع‌رسانی به هر نفر در روز (محافظ هزینه) */
export const HR_SMS_PER_PERSON_DAILY_CAP = 5;
export const HR_SMS_MAX_TEMPLATE_LENGTH = 400;
export const HR_SMS_NOTE_MAX = 50;
export const HR_SMS_MESSAGE_MAX = 300;

export function defaultHrSmsSettings(): HrRequestSmsSettings {
  return {
    enabled: true,
    events: { SUBMITTED: false, APPROVED: true, REJECTED: true, CANCELLED: false },
    types: { LEAVE_REQUEST: true },
    templates: { ...HR_SMS_DEFAULT_TEMPLATES },
    dailyCap: HR_SMS_DAILY_CAP_DEFAULT,
  };
}

/** ترکیب مقدار ذخیره‌شده با پیش‌فرض‌ها؛ هر مقدار نامعتبر به پیش‌فرض برمی‌گردد. */
export function mergeHrSmsSettings(raw: unknown): HrRequestSmsSettings {
  const d = defaultHrSmsSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof HrRequestSmsSettings, unknown>>;
  const out = { ...d, events: { ...d.events }, types: { ...d.types }, templates: { ...d.templates } };
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
  if (r.events && typeof r.events === 'object') for (const e of HR_SMS_EVENTS) { const v = (r.events as Record<string, unknown>)[e]; if (typeof v === 'boolean') out.events[e] = v; }
  if (r.types && typeof r.types === 'object') for (const t of HR_REQUEST_TYPES) { const v = (r.types as Record<string, unknown>)[t]; if (typeof v === 'boolean') out.types[t] = v; }
  if (r.templates && typeof r.templates === 'object') {
    for (const e of HR_SMS_EVENTS) {
      const v = (r.templates as Record<string, unknown>)[e];
      if (typeof v === 'string' && v.trim() && v.length <= HR_SMS_MAX_TEMPLATE_LENGTH && unknownHrSmsPlaceholders(v).length === 0) out.templates[e] = v;
    }
  }
  if (typeof r.dailyCap === 'number' && Number.isInteger(r.dailyCap) && r.dailyCap >= 1 && r.dailyCap <= HR_SMS_DAILY_CAP_MAX) out.dailyCap = r.dailyCap;
  return out;
}

const RE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
const KNOWN = new Set<string>(HR_SMS_PLACEHOLDERS);

export function unknownHrSmsPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(RE)) if (!KNOWN.has(m[1])) out.add(m[1]);
  return [...out];
}

/** پاک‌سازی مقدار درج‌شده در پیامک: بدون کنترل‌کاراکتر/خط جدید/لینک/براکت زاویه‌ای/آکولاد، فاصله‌ها فشرده، با سقف طول. */
export function sanitizeSmsValue(v: string | null | undefined, max = 80): string {
  const s = (v ?? '')
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * جایگزینی تک‌گذر: جانشین ناشناخته دست‌نخورده نمی‌ماند (حذف می‌شود)، مقدار خالی ⇒ حذف، مقدار حاوی {{x}} دوباره جایگزین نمی‌شود
 * (چون قبلاً { } از مقدار پاک شده). سپس فاصله‌های اضافه فشرده و طول کل محدود می‌شود.
 */
export function renderHrSms(template: string, ctx: HrSmsContext): string {
  const text = template.replace(RE, (_whole, name: string) => {
    if (!KNOWN.has(name)) return '';
    const v = ctx[name as HrSmsPlaceholder];
    return sanitizeSmsValue(v, name === 'note' ? HR_SMS_NOTE_MAX : 80);
  });
  const clean = text.replace(/\s+/g, ' ').replace(/\s+([.،:؛])/g, '$1').trim();
  return clean.length > HR_SMS_MESSAGE_MAX ? `${clean.slice(0, HR_SMS_MESSAGE_MAX - 1).trimEnd()}…` : clean;
}

/** شماره‌ی موبایل ایران → ۰۹xxxxxxxxx یا null (نامعتبر). */
export function normalizeIranMobile(raw: string | null | undefined): string | null {
  const d = (raw ?? '')
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/\D/g, '');
  const m = /^(?:98|0098)?0?(9\d{9})$/.exec(d);
  return m ? `0${m[1]}` : null;
}

export function maskPhone(p: string): string {
  return `${p.slice(0, 4)}•••${p.slice(-3)}`;
}

export function hrSmsClaimKey(type: string, id: string, event: string): string {
  return `${type}:${id}:${event}`;
}

/** اعتبارسنجی ورودی تنظیمات (PUT) — خطا ⇒ متن فارسی. */
export function validateHrSmsSettingsInput(input: Partial<HrRequestSmsSettings>): string | null {
  if (input.templates) {
    for (const [event, t] of Object.entries(input.templates)) {
      if (!HR_SMS_EVENTS.includes(event as HrSmsEvent)) return `رویداد «${event}» نامعتبر است`;
      if (typeof t !== 'string') return 'قالب باید متن باشد';
      if (t.length > HR_SMS_MAX_TEMPLATE_LENGTH) return `قالب پیامک حداکثر ${HR_SMS_MAX_TEMPLATE_LENGTH} نویسه است`;
      const unknown = unknownHrSmsPlaceholders(t);
      if (unknown.length) return `جانشین‌های ناشناخته در قالب: ${unknown.map((u) => `{{${u}}}`).join('، ')}`;
    }
  }
  if (input.dailyCap !== undefined && (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > HR_SMS_DAILY_CAP_MAX)) {
    return `سقف روزانه باید بین ۱ و ${HR_SMS_DAILY_CAP_MAX} باشد`;
  }
  return null;
}
