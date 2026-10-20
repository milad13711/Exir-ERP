import { escapeHtml } from '../common/pdf-font.js';

/** جانشین‌های مجاز قالب: {{name}} */
export const TEMPLATE_PLACEHOLDERS = [
  'recipientName', 'recipientTitle', 'subject', 'date', 'number', 'senderName', 'senderTitle', 'orgName', 'attachments', 'departmentName',
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateContext = Partial<Record<TemplatePlaceholder, string | null | undefined>>;

export const PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  recipientName: 'نام گیرنده', recipientTitle: 'سمت گیرنده', subject: 'موضوع', date: 'تاریخ', number: 'شماره‌ی نامه',
  senderName: 'نام فرستنده', senderTitle: 'سمت فرستنده', orgName: 'نام سازمان', attachments: 'پیوست‌ها', departmentName: 'نام واحد',
};

const RE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_PLACEHOLDERS);

/** نام جانشین‌های ناشناخته‌ی موجود در متن (برای رد کردن غلط املایی هنگام ذخیره). */
export function unknownPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(RE)) if (!KNOWN.has(m[1])) out.add(m[1]);
  return [...out];
}

function fill(text: string, ctx: TemplateContext, escape: boolean): string {
  return text.replace(RE, (whole, name: string) => {
    if (!KNOWN.has(name)) return whole; // ناشناخته: دست‌نخورده (متن ساده)
    const v = ctx[name as TemplatePlaceholder];
    if (v === undefined) return whole; // مقدار داده نشده: جانشین برای پر کردن دستی می‌ماند
    const s = v ?? '';
    return escape ? escapeHtml(s) : s;
  });
}

/**
 * جایگزینی جانشین‌ها — تابع خالص. مقدارهای درج‌شده در bodyHtml HTML-escape می‌شوند (تزریق تگ/ویژگی ممکن نیست)؛
 * موضوع متن ساده است و escape نمی‌شود (رندر PDF/UI خودش escape می‌کند). تک‌گذر است: مقدار حاوی {{x}} دوباره جایگزین نمی‌شود.
 */
export function applyTemplate(template: { subject: string; bodyHtml: string }, context: TemplateContext): { subject: string; bodyHtml: string } {
  return { subject: fill(template.subject, context, false), bodyHtml: fill(template.bodyHtml, context, true) };
}
