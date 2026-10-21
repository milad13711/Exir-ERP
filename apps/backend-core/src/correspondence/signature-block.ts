import { cleanText } from './text-clean.js';

/**
 * بلوک امضای نامه — سه خط وسط‌چین داخل بلوک:
 *   خط ۱ = «سمت امضاکننده + نام شرکت» (مثلاً «مدیرعامل شرکت اکسیرتجارت امین»)
 *   خط ۲ = «پیشوند + نام امضاکننده» (مثلاً «آقای علی رضایی»)
 *   خط ۳ = مهر و امضا (تصاویر)
 * فیلدها قابل‌ویرایش‌اند؛ خالی/نبودن یعنی «خودکار» از پیش‌فرض سازمان/امضاکننده و پروفایل. پس از امضا همه‌چیز (به‌همراه
 * خطوط نهایی) در نامه ثابت می‌شود و دیگر از تنظیمات خوانده نمی‌شود.
 */
export const HONORIFICS: readonly { value: string; label: string }[] = [
  { value: '', label: 'بدون پیشوند' },
  { value: 'آقای', label: 'آقای' },
  { value: 'خانم', label: 'خانم' },
  { value: 'دکتر', label: 'دکتر' },
  { value: 'مهندس', label: 'مهندس' },
  { value: 'جناب آقای', label: 'جناب آقای' },
  { value: 'سرکار خانم', label: 'سرکار خانم' },
];

export type SignatureBlock = {
  signerTitle?: string | null;
  orgName?: string | null;
  signerName?: string | null;
  honorific?: string | null;
  showDate?: boolean | null;
  /** فقط سرور و هنگام امضا پر می‌کند (نسخه‌ی ثابت‌شده) */
  titleLine?: string | null;
  nameLine?: string | null;
};

export type SignerOverride = { titleTemplate?: string; nameTemplate?: string; signerTitle?: string; honorific?: string; showDate?: boolean };
export type SignatureDefaults = {
  titleTemplate: string;
  nameTemplate: string;
  honorific: string;
  showDate: boolean;
  perSigner: Record<string, SignerOverride>;
};

export const DEFAULT_SIGNATURE_DEFAULTS: SignatureDefaults = {
  titleTemplate: '{{signerTitle}} {{orgName}}',
  nameTemplate: '{{honorific}} {{signerName}}',
  honorific: '',
  showDate: true,
  perSigner: {},
};

export const SETTING_MODULE = 'correspondence';
export const SETTING_KEY = 'signatureDefaults';

const LIMITS = { signerTitle: 120, orgName: 120, signerName: 80, honorific: 20, template: 200 } as const;
const TEMPLATE_VARS = new Set(['signerTitle', 'orgName', 'signerName', 'honorific']);

const clip = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? cleanText(v).replace(/\s+/g, ' ').trim().slice(0, max) : undefined);

/** قالب فقط {{signerTitle}} {{orgName}} {{signerName}} {{honorific}} را می‌پذیرد؛ HTML/اسکریپت جایی ندارد (خروجی همیشه escape می‌شود). */
export function validateTemplate(t: unknown, label: string): string {
  const s = clip(t, LIMITS.template);
  if (!s) throw new Error(`${label} خالی است`);
  for (const m of s.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)) if (!TEMPLATE_VARS.has(m[1])) throw new Error(`${label}: جانشین ناشناخته {{${m[1]}}}`);
  if (/[<>]/.test(s) || /\{\{[^}]*$/.test(s.replace(/\{\{\s*[A-Za-z]+\s*\}\}/g, ''))) throw new Error(`${label}: قالب نامعتبر است`);
  return s;
}

export function fillTemplate(tpl: string, vars: Record<string, string | undefined | null>): string {
  return tpl
    .replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_m, k: string) => (TEMPLATE_VARS.has(k) ? (vars[k] ?? '') : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** ورودی کاربر برای بلوک → شیء پاک‌سازی‌شده (کلیدهای شناخته‌شده، متن تمیز، حداکثر طول). خطوط نهایی هرگز از کلاینت نمی‌آید. */
export function sanitizeSignatureBlock(input: unknown): SignatureBlock {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const o = input as Record<string, unknown>;
  const out: SignatureBlock = {};
  const t = clip(o.signerTitle, LIMITS.signerTitle);
  const org = clip(o.orgName, LIMITS.orgName);
  const nm = clip(o.signerName, LIMITS.signerName);
  const hon = clip(o.honorific, LIMITS.honorific);
  if (t !== undefined) out.signerTitle = t;
  if (org !== undefined) out.orgName = org;
  if (nm !== undefined) out.signerName = nm;
  if (hon !== undefined) out.honorific = hon;
  if (typeof o.showDate === 'boolean') out.showDate = o.showDate;
  return out;
}

export function sanitizeDefaults(input: unknown): SignatureDefaults {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const per: Record<string, SignerOverride> = {};
  const rawPer = o.perSigner && typeof o.perSigner === 'object' && !Array.isArray(o.perSigner) ? (o.perSigner as Record<string, unknown>) : {};
  for (const [uid, v] of Object.entries(rawPer).slice(0, 500)) {
    if (!/^[0-9a-zA-Z_-]{1,64}$/.test(uid) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const ov: SignerOverride = {};
    if (r.titleTemplate !== undefined && r.titleTemplate !== '') ov.titleTemplate = validateTemplate(r.titleTemplate, 'قالب سطر ۱');
    if (r.nameTemplate !== undefined && r.nameTemplate !== '') ov.nameTemplate = validateTemplate(r.nameTemplate, 'قالب سطر ۲');
    const st = clip(r.signerTitle, LIMITS.signerTitle);
    const hon = clip(r.honorific, LIMITS.honorific);
    if (st) ov.signerTitle = st;
    if (hon !== undefined) ov.honorific = hon;
    if (typeof r.showDate === 'boolean') ov.showDate = r.showDate;
    if (Object.keys(ov).length) per[uid] = ov;
  }
  return {
    titleTemplate: o.titleTemplate === undefined ? DEFAULT_SIGNATURE_DEFAULTS.titleTemplate : validateTemplate(o.titleTemplate, 'قالب سطر ۱'),
    nameTemplate: o.nameTemplate === undefined ? DEFAULT_SIGNATURE_DEFAULTS.nameTemplate : validateTemplate(o.nameTemplate, 'قالب سطر ۲'),
    honorific: clip(o.honorific, LIMITS.honorific) ?? DEFAULT_SIGNATURE_DEFAULTS.honorific,
    showDate: typeof o.showDate === 'boolean' ? o.showDate : DEFAULT_SIGNATURE_DEFAULTS.showDate,
    perSigner: per,
  };
}

export type ResolveInput = {
  block: SignatureBlock | null | undefined;
  defaults: SignatureDefaults;
  signerUserId?: string | null;
  /** سمت از پروفایل/پرسنلی (Employee.position) */
  profileTitle?: string | null;
  profileName: string;
  orgName: string;
};
export type ResolvedSignature = {
  fields: { signerTitle: string; orgName: string; signerName: string; honorific: string; showDate: boolean };
  titleLine: string;
  nameLine: string;
  showDate: boolean;
};

export function resolveSignatureBlock(i: ResolveInput): ResolvedSignature {
  const b = i.block ?? {};
  const ov = (i.signerUserId && i.defaults.perSigner[i.signerUserId]) || {};
  const fields = {
    signerTitle: b.signerTitle ?? ov.signerTitle ?? i.profileTitle ?? '',
    orgName: b.orgName ?? i.orgName,
    signerName: b.signerName ?? i.profileName,
    honorific: b.honorific ?? ov.honorific ?? i.defaults.honorific,
    showDate: b.showDate ?? ov.showDate ?? i.defaults.showDate,
  };
  // نسخه‌ی ثابت‌شده‌ی پس از امضا: خطوط همان‌اند که بودند
  if (b.titleLine !== undefined && b.titleLine !== null && b.nameLine !== undefined && b.nameLine !== null) {
    return { fields, titleLine: b.titleLine, nameLine: b.nameLine, showDate: fields.showDate };
  }
  const titleTpl = ov.titleTemplate ?? i.defaults.titleTemplate;
  const nameTpl = ov.nameTemplate ?? i.defaults.nameTemplate;
  const vars = { signerTitle: fields.signerTitle, orgName: fields.orgName, signerName: fields.signerName, honorific: fields.honorific };
  return { fields, titleLine: fillTemplate(titleTpl, vars), nameLine: fillTemplate(nameTpl, vars), showDate: fields.showDate };
}

/** آنچه هنگام امضا در نامه ثابت می‌شود (فیلدها + خطوط نهایی). */
export function freezeSignatureBlock(r: ResolvedSignature): SignatureBlock {
  return { ...r.fields, titleLine: r.titleLine, nameLine: r.nameLine };
}
