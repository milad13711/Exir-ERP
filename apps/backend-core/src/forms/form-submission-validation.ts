import { BadRequestException } from '@nestjs/common';

/** اعتبارسنجی و نرمال‌سازی سمت سرور برای ارسال عمومی فرم — هر سه قالب (JSON آرایه‌ای، JSON نگاشتی، فرم HTML) را می‌پذیرد. */

export type ValidatableField = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options: string[];
};

export type NormalizedSubmission = {
  respondentName: string | null;
  respondentPhone: string | null;
  answers: Array<{ fieldId: string; valueText: string | null; valueOptions: string[] }>;
  honeypotTripped: boolean;
  captchaToken: string | null;
  source: { url: string | null; utm: Record<string, string>; referrer: string | null };
};

export const LIMITS = {
  shortText: 500,
  longText: 5000,
  name: 120,
  email: 254,
  date: 40,
  number: 40,
  sourceUrl: 500,
  utmValue: 200,
  maxUtmKeys: 10,
  maxOptionsSelected: 50,
} as const;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

export function toAsciiDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (c) => {
    const i = PERSIAN_DIGITS.indexOf(c);
    return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(c));
  });
}

/** کاراکترهای کنترلی (به‌جز خط‌جدید و تب) حذف می‌شوند. HTML escape هنگام نمایش انجام می‌شود (React) — نه اینجا. */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n/g, '\n').trim();
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizePhone(raw: string): string | null {
  const digits = toAsciiDigits(raw).replace(/[\s\-()]/g, '');
  const plus = digits.startsWith('+') ? '+' : '';
  const body = digits.replace(/\D/g, '');
  if (body.length < 7 || body.length > 15) return null;
  return plus + body;
}

type RawAnswer = { valueText?: unknown; valueOptions?: unknown; value?: unknown };

/** هر مقدار خام را به {text, options} تبدیل می‌کند. */
function rawToParts(v: unknown): { text: string | null; options: string[] } {
  if (Array.isArray(v)) return { text: null, options: v.map((x) => str(x)).filter((x): x is string => x !== null) };
  if (isObject(v)) {
    const a = v as RawAnswer;
    const options = Array.isArray(a.valueOptions) ? a.valueOptions.map((x) => str(x)).filter((x): x is string => x !== null) : [];
    return { text: str(a.valueText ?? a.value), options };
  }
  return { text: str(v), options: [] };
}

function validateOne(field: ValidatableField, text: string | null, options: string[]): { valueText: string | null; valueOptions: string[] } | null {
  const label = `«${field.label}»`;
  const t = text !== null ? clean(text) : '';

  switch (field.type) {
    case 'MULTI_CHOICE': {
      const picked = options.length > 0 ? options : t ? t.split(/[,،]\s*/) : [];
      const uniq = [...new Set(picked.map((o) => clean(o)).filter(Boolean))];
      if (uniq.length > LIMITS.maxOptionsSelected) throw new BadRequestException(`تعداد گزینه‌های ${label} زیاد است`);
      for (const o of uniq) if (!field.options.includes(o)) throw new BadRequestException(`گزینه‌ی انتخاب‌شده برای ${label} معتبر نیست`);
      return uniq.length ? { valueText: null, valueOptions: uniq } : null;
    }
    case 'SINGLE_CHOICE': {
      if (!t) return null;
      if (!field.options.includes(t)) throw new BadRequestException(`گزینه‌ی انتخاب‌شده برای ${label} معتبر نیست`);
      return { valueText: t, valueOptions: [] };
    }
    case 'RATING': {
      if (!t) return null;
      const n = Number(toAsciiDigits(t));
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException(`امتیاز ${label} باید عددی از ۱ تا ۵ باشد`);
      return { valueText: String(n), valueOptions: [] };
    }
    case 'NUMBER': {
      if (!t) return null;
      const a = toAsciiDigits(t).replace(/[,٬]/g, '');
      if (a.length > LIMITS.number || !/^-?\d+(\.\d+)?$/.test(a)) throw new BadRequestException(`مقدار ${label} باید عدد باشد`);
      return { valueText: a, valueOptions: [] };
    }
    case 'PHONE': {
      if (!t) return null;
      const p = normalizePhone(t);
      if (!p) throw new BadRequestException(`شماره‌ی ${label} معتبر نیست`);
      return { valueText: p, valueOptions: [] };
    }
    case 'EMAIL': {
      if (!t) return null;
      if (t.length > LIMITS.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(t)) throw new BadRequestException(`ایمیل ${label} معتبر نیست`);
      return { valueText: t, valueOptions: [] };
    }
    case 'DATE': {
      if (!t) return null;
      if (t.length > LIMITS.date || !/^[\d۰-۹٠-٩\-/.: T]+Z?$/.test(t)) throw new BadRequestException(`تاریخ ${label} معتبر نیست`);
      return { valueText: t, valueOptions: [] };
    }
    case 'LONG_TEXT': {
      if (!t) return null;
      if (t.length > LIMITS.longText) throw new BadRequestException(`پاسخ ${label} بیش از حد طولانی است`);
      return { valueText: t, valueOptions: [] };
    }
    default: {
      if (!t) return null;
      if (t.length > LIMITS.shortText) throw new BadRequestException(`پاسخ ${label} بیش از حد طولانی است`);
      return { valueText: t, valueOptions: [] };
    }
  }
}

function readSource(body: Record<string, unknown>): NormalizedSubmission['source'] {
  const src = isObject(body.source) ? body.source : {};
  const meta = isObject(body.meta) ? body.meta : {};
  const merged: Record<string, unknown> = { ...meta, ...src };
  const urlRaw = str(merged.url ?? merged.sourceUrl ?? body.sourceUrl);
  let url: string | null = null;
  if (urlRaw && /^https?:\/\//i.test(urlRaw.trim())) url = urlRaw.trim().slice(0, LIMITS.sourceUrl);
  const refRaw = str(merged.referrer);
  const referrer = refRaw && /^https?:\/\//i.test(refRaw.trim()) ? refRaw.trim().slice(0, LIMITS.sourceUrl) : null;
  const utmIn = isObject(merged.utm) ? merged.utm : merged;
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = str(utmIn[k]);
    if (v && Object.keys(utm).length < LIMITS.maxUtmKeys) utm[k] = clean(v).slice(0, LIMITS.utmValue);
  }
  return { url, utm, referrer };
}

/**
 * @throws BadRequestException با پیام فارسی برای اولین خطا
 */
export function validateSubmission(
  form: { collectPhone: boolean; requirePhone: boolean; fields: ValidatableField[] },
  rawBody: unknown,
): NormalizedSubmission {
  if (!isObject(rawBody)) throw new BadRequestException('بدنه‌ی درخواست معتبر نیست');
  const body = rawBody;

  const nameRaw = str(body.respondentName ?? body.name);
  const respondentName = nameRaw ? clean(nameRaw).slice(0, LIMITS.name) || null : null;
  const phoneRaw = str(body.respondentPhone ?? body.phone);
  let respondentPhone: string | null = null;
  if (phoneRaw && clean(phoneRaw)) {
    respondentPhone = normalizePhone(clean(phoneRaw));
    if (!respondentPhone) throw new BadRequestException('شماره موبایل معتبر نیست');
  }
  if (form.requirePhone && !respondentPhone) throw new BadRequestException('شماره موبایل الزامی است');

  // مقادیر خام: آرایه‌ی [{fieldId,...}] یا نگاشت {fieldId: value} یا کلیدهای تخت با نام = شناسه‌ی فیلد (فرم HTML)
  const raw = new Map<string, unknown>();
  const ans = body.answers;
  if (Array.isArray(ans)) {
    for (const item of ans.slice(0, 200)) {
      if (isObject(item) && typeof item.fieldId === 'string') raw.set(item.fieldId, item);
    }
  } else if (isObject(ans)) {
    for (const [k, v] of Object.entries(ans)) raw.set(k, v);
  }
  for (const f of form.fields) {
    if (!raw.has(f.id) && body[f.id] !== undefined) raw.set(f.id, body[f.id]);
  }

  const answers: NormalizedSubmission['answers'] = [];
  for (const f of form.fields) {
    const { text, options } = rawToParts(raw.get(f.id));
    const v = validateOne(f, text, options);
    if (!v) {
      if (f.required) throw new BadRequestException(`پاسخ به «${f.label}» الزامی است`);
      continue;
    }
    answers.push({ fieldId: f.id, ...v });
  }

  return {
    respondentName,
    respondentPhone,
    answers,
    honeypotTripped: typeof body._hp === 'string' && body._hp.trim() !== '',
    captchaToken: str(body.captchaToken ?? body['cf-turnstile-response'] ?? body['h-captcha-response']),
    source: readSource(body),
  };
}

/** 185.10.20.30 → 185.10.20.x ؛ IPv6 → فقط ۳ گروه اول. */
export function maskIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/, '');
  if (v.includes(':')) return v.split(':').slice(0, 3).join(':') + ':****';
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
}
