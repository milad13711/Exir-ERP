import { createHash } from 'node:crypto';

/** منطق خالصِ تأیید مدیر برای فاکتورهای تننت‌ها. */

export type InvoiceIssueSource = 'AUTO' | 'STAFF' | 'MANUAL' | 'CHECKOUT';

export type InvoiceApprovalSettings = {
  /** فاکتورهای خودکار (تمدید ماژول و...) ابتدا در کارتابل تأیید مدیر تننت مادر می‌نشینند */
  requireForAuto: boolean;
  /** فاکتورهایی که کارشناس پنل ادمین دستی صادر می‌کند هم تأیید مدیر بخواهند (پیش‌فرض خاموش) */
  requireForStaff: boolean;
  /** maker-checker: کسی که فاکتور را ویرایش کرده نتواند خودش تأییدش کند (پیش‌فرض خاموش) */
  requireDifferentApprover: boolean;
};

export const INVOICE_APPROVAL_DEFAULTS: InvoiceApprovalSettings = { requireForAuto: true, requireForStaff: false, requireDifferentApprover: false };

export function normalizeInvoiceApprovalSettings(raw: unknown): InvoiceApprovalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    requireForAuto: typeof r.requireForAuto === 'boolean' ? r.requireForAuto : INVOICE_APPROVAL_DEFAULTS.requireForAuto,
    requireForStaff: typeof r.requireForStaff === 'boolean' ? r.requireForStaff : INVOICE_APPROVAL_DEFAULTS.requireForStaff,
    requireDifferentApprover: typeof r.requireDifferentApprover === 'boolean' ? r.requireDifferentApprover : INVOICE_APPROVAL_DEFAULTS.requireDifferentApprover,
  };
}

/**
 * آیا فاکتور باید منتظر تأیید بماند؟
 *  - MANUAL (مدیر تننت مادر خودش صادر کرده) و CHECKOUT (خرید لحظه‌ای مشتری) هیچ‌وقت منتظر تأیید نمی‌مانند.
 *  - بدون تننت مادر (کسی نیست که تأیید کند) هرگز نگه نمی‌داریم تا فاکتور برای همیشه گیر نکند.
 */
export function requiresApproval(source: InvoiceIssueSource, settings: InvoiceApprovalSettings, parentExists: boolean): boolean {
  if (!parentExists) return false;
  if (source === 'AUTO') return settings.requireForAuto;
  if (source === 'STAFF') return settings.requireForStaff;
  return false;
}

export const PURPOSE_LABEL: Record<string, string> = {
  TENANT_SETUP: 'راه‌اندازی تننت',
  PLAN_RENEWAL: 'تمدید پلن',
  MODULE_PURCHASE: 'خرید ماژول',
  MODULE_RENEWAL: 'تمدید ماژول',
  SMS_PACKAGE: 'بسته‌ی پیامک',
};

export const MODE_LABEL: Record<string, string> = { LICENSE: 'لایسنس مادام‌العمر', YEARLY: 'اشتراک سالانه', MONTHLY: 'اشتراک ماهانه', MANUAL: 'دستی' };

export type InvoiceLine = { moduleCode: string; moduleName: string; billingMode: string; amount: number };

export function linesOf(items: unknown): InvoiceLine[] {
  return Array.isArray(items) ? (items as InvoiceLine[]) : [];
}

export function describeLines(items: unknown): string {
  return linesOf(items).map((l) => `${l.moduleName} (${MODE_LABEL[l.billingMode] ?? l.billingMode}) — ${Number(l.amount).toLocaleString('en-US')}`).join('، ');
}

/** ویرایش مبلغ ریزخط‌ها قبل از تأیید؛ جمع کل همیشه از ریزخط‌ها محاسبه می‌شود. */
export function applyLineEdits(items: unknown, edits: Array<{ index: number; amount: number }>): { items: InvoiceLine[]; amount: number } {
  const lines = linesOf(items).map((l) => ({ ...l }));
  for (const e of edits) {
    if (Number.isInteger(e.index) && e.index >= 0 && e.index < lines.length && Number.isFinite(e.amount) && e.amount >= 0) lines[e.index]!.amount = Math.round(e.amount);
  }
  return { items: lines, amount: lines.reduce((s, l) => s + l.amount, 0) };
}

/** اثرانگشت محتوایی که مدیر در کارتابل می‌بیند (مبلغ، سررسید، اقلام). */
export function invoiceContentHash(inv: { amount: number; dueAt: Date; items: unknown }): string {
  return createHash('sha256').update(JSON.stringify([inv.amount, inv.dueAt.toISOString(), inv.items ?? null])).digest('hex').slice(0, 32);
}
