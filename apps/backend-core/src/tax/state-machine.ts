import { BadRequestException } from '@nestjs/common';
import type { TaxInvoiceStatus } from './client/types.js';

/**
 * ماشین وضعیت صورتحساب مالیاتی. هر تغییر وضعیت باید از این جدول بگذرد؛ جز آن‌ها ممنوع است.
 *
 *  DRAFT ─request→ PENDING_APPROVAL ─approve→ APPROVED ─queue→ QUEUED ─send→ SENT ─inquiry→ ACCEPTED | REJECTED
 *  QUEUED/SENT-نشده → FAILED (خطای انتقال/فنی؛ ارسال مجدد با همان uid و retry=true)
 *  REJECTED → DRAFT (اصلاح داده + تأیید دوباره)   |   PENDING_APPROVAL/رد مدیر → DRAFT
 *  DRAFT/PENDING_APPROVAL/APPROVED/FAILED/REJECTED → CANCELLED (انصراف قبل از پذیرش)
 */
const ALLOWED: Record<TaxInvoiceStatus, TaxInvoiceStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['SENT', 'FAILED', 'APPROVED'], // APPROVED: ارسال به‌دلیل گارد انجام نشد (هیچ بسته‌ای نرفت)
  SENT: ['ACCEPTED', 'REJECTED', 'FAILED'],
  ACCEPTED: [],
  REJECTED: ['DRAFT', 'CANCELLED'],
  FAILED: ['QUEUED', 'DRAFT', 'CANCELLED', 'SENT'], // SENT: uid پیش‌تر دریافت شده بود (۵۰۰۵) → پیگیری با استعلام
  CANCELLED: [],
};

export function canTransition(from: TaxInvoiceStatus, to: TaxInvoiceStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: TaxInvoiceStatus, to: TaxInvoiceStatus): void {
  if (!canTransition(from, to)) throw new BadRequestException(`تغییر وضعیت از «${from}» به «${to}» مجاز نیست`);
}

/** وضعیت‌هایی که فاکتور فروش را برای تغییر فیلدهای مالیاتی قفل می‌کنند. */
export const LOCKING_STATUSES: readonly TaxInvoiceStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENT', 'ACCEPTED'];
/** وضعیت‌هایی که بدنه‌ی فاکتور هنوز قابل بازسازی است (تأییدنشده). */
export const EDITABLE_STATUSES: readonly TaxInvoiceStatus[] = ['DRAFT'];
