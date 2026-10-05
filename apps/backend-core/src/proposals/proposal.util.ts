import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { publicRef } from '../common/tenant-public-key.js';
import { toJalaliDate } from '../common/jalali.js';

/** وضعیت‌هایی که پاسخ مشتری (پذیرش/رد/اصلاح) هنوز در آن‌ها معنا دارد. */
export const CUSTOMER_OPEN_STATUSES = ['SENT', 'VIEWED', 'REVISION_REQUESTED'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** همین مدت بین دو مشاهده‌ی یکسان (IP + مرورگر) فقط یک مشاهده ثبت می‌شود. */
export const VIEW_DEDUPE_MS = 10 * 60 * 1000;
/** اعلان مشاهده‌های بعد از اولی حداکثر در هر این بازه یک‌بار. */
export const VIEW_NOTIFY_THROTTLE_MS = 60 * 60 * 1000;

/**
 * لحظه‌ی پایان اعتبار. تاریخ انتخابی از تقویم (YYYY-MM-DD → نیمه‌شب UTC) تا «پایان همان روز» معتبر است؛
 * مقدار دارای ساعت دقیقاً همان لحظه است.
 */
export function expiryInstant(validUntil: Date): number {
  const t = validUntil.getTime();
  return t % DAY_MS === 0 ? t + DAY_MS - 1 : t;
}

export function isProposalExpired(validUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return !!validUntil && now.getTime() > expiryInstant(validUntil);
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

export function formatJalaliFa(date: Date): string {
  const j = toJalaliDate(date);
  return faDigits(`${j.year}/${String(j.month).padStart(2, '0')}/${String(j.day).padStart(2, '0')}`);
}

export function proposalPublicUrl(publicWebUrl: string, tenantSlug: string, token: string): string {
  return `${publicWebUrl.replace(/\/$/, '')}/proposal/${publicRef(tenantSlug)}/${token}`;
}

export type ProposalInvoiceLine = { description: string; quantity: number; unitPrice: number };

/** ردیف‌های فاکتور: ردیف‌های تعریف‌شده‌ی کاربر، وگرنه یک ردیف به مبلغ پروژه. */
export function resolveInvoiceLines(
  proposal: { proposalNo: number; title: string; amount: number; invoiceLines: unknown },
  override?: ProposalInvoiceLine[],
): ProposalInvoiceLine[] {
  const own = override ?? (Array.isArray(proposal.invoiceLines) ? (proposal.invoiceLines as ProposalInvoiceLine[]) : []);
  if (own.length > 0) return own.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }));
  return [{ description: `${proposal.title} (پروپوزال شماره ${faDigits(proposal.proposalNo)})`, quantity: 1, unitPrice: proposal.amount }];
}

/** یادداشت فاکتور: شماره‌ی پروپوزال + سررسید + مهلت پرداخت + شرایط پرداخت. */
export function buildInvoiceNotes(
  proposal: { proposalNo: number; title: string; paymentDeadline: string | null; paymentTerms: string | null; paymentMethodText: string | null },
  dueAt: Date | null | undefined,
): string {
  const lines = [`صادرشده از پروپوزال شماره ${faDigits(proposal.proposalNo)} — ${proposal.title}`];
  if (dueAt) lines.push(`تاریخ سررسید: ${formatJalaliFa(dueAt)}`);
  if (proposal.paymentDeadline?.trim()) lines.push(`مهلت پرداخت: ${proposal.paymentDeadline.trim()}`);
  if (proposal.paymentMethodText?.trim()) lines.push(`روش پرداخت: ${proposal.paymentMethodText.trim()}`);
  if (proposal.paymentTerms?.trim()) lines.push(`شرایط پرداخت: ${proposal.paymentTerms.trim()}`);
  return lines.join('\n');
}

export function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

/** رویدادهایی که علاوه بر خط زمانی پروپوزال، در تاریخچه‌ی مشتری (CRM) هم یادداشت می‌شوند. */
const CRM_VISIBLE_EVENTS = new Set(['CREATED', 'SENT', 'SMS_SENT', 'VIEWED_FIRST', 'ACCEPTED', 'REJECTED', 'REVISION_REQUESTED', 'INVOICED']);

export type ProposalEventInput = {
  proposalId: string;
  contactId: string;
  proposalNo: number;
  type: string;
  body?: string;
  userId?: string | null;
};

/** ثبت رویداد در خط زمانی پروپوزال + (برای رویدادهای مهم) یادداشت در تاریخچه‌ی CRM مشتری. هرگز عملیات اصلی را خراب نمی‌کند. */
export async function recordProposalEvent(db: TenantPrismaClient, input: ProposalEventInput, crmText?: string): Promise<void> {
  try {
    await db.proposalEvent.create({ data: { proposalId: input.proposalId, type: input.type, body: input.body, userId: input.userId ?? undefined } });
    if (CRM_VISIBLE_EVENTS.has(input.type)) {
      await db.crmActivity.create({
        data: {
          type: 'NOTE',
          contactId: input.contactId,
          userId: input.userId ?? undefined,
          body: crmText ?? `پروپوزال شماره ${faDigits(input.proposalNo)}: ${input.body ?? input.type}`,
        },
      });
    }
  } catch {
    // ثبت تاریخچه نباید پاسخ مشتری یا عملیات کاربر را شکست بدهد
  }
}

export function extractClientIp(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): string | undefined {
  const forwarded = headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return (first || remoteAddress || undefined)?.slice(0, 64);
}
