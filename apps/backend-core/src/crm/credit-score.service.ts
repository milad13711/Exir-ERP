import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { PartyStatementService } from './party-statement.service.js';

export type CreditAssessment = {
  score: number; // ۰ تا ۱۰۰
  creditLimit: number; // سقف فروش اعتباری، تومان
  basis: 'new' | 'history';
  totalOutstanding: number; // مجموع مانده‌ی فاکتورهای تسویه‌نشده
  reasons: string[];
};

/**
 * A simple, transparent (not a black-box credit-bureau score) heuristic for
 * how much credit sale a customer can reasonably be extended, built entirely
 * from data already in this system — there's no external credit-bureau
 * integration. Every factor is documented so a manager can sanity-check or
 * override it (see CrmContact.creditLimitOverride).
 *
 * Two paths:
 *  - A customer with confirmed invoice history: score from on-time-payment
 *    rate, purchase volume, order frequency, and early-settlement rate,
 *    penalized for currently-overdue invoices and any recorded bounced
 *    check.
 *  - A brand-new customer (no invoice history): starts neutral and is
 *    adjusted only by the manually-entered signals staff collect up front —
 *    prior bounced checks and the average monthly bank-statement turnover.
 */
@Injectable()
export class CreditScoreService {
  constructor(private readonly partyStatement: PartyStatementService) {}

  async assess(ctx: TenantRequestContext, contactId: string): Promise<CreditAssessment> {
    const contact = await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: contactId } });
    const invoices = await ctx.tenantDb.salesInvoice.findMany({
      where: { contactId, status: { not: 'DRAFT' } },
      include: { payments: { select: { paidAt: true } } },
    });

    // مانده‌ی واقعی طلب ما از این مشتری — نه فقط جمع فاکتورها، بلکه با
    // احتساب مرجوعی فروش و دریافت‌های آزاد (PartyTransaction) هم، دقیقاً
    // همان arBalance که در گردش حساب طرف‌حساب محاسبه می‌شود.
    const { arBalance } = await this.partyStatement.statement(ctx, contactId);
    const totalOutstanding = Math.max(0, arBalance);

    if (invoices.length === 0) {
      return this.assessNewCustomer(contact, totalOutstanding);
    }
    return this.assessWithHistory(contact, invoices, totalOutstanding);
  }

  private assessNewCustomer(
    contact: { hasBouncedChecks: boolean; bankAvgMonthlyTurnover: number | null; creditLimitOverride: number | null },
    totalOutstanding: number,
  ): CreditAssessment {
    let score = 50;
    const reasons: string[] = ['مشتری بدون سابقه‌ی خرید — بر اساس اطلاعات اعلامی محاسبه شده است'];

    if (contact.hasBouncedChecks) {
      score -= 40;
      reasons.push('سابقه‌ی چک برگشتی ثبت شده — ریسک بالا');
    }

    const turnover = contact.bankAvgMonthlyTurnover ?? 0;
    if (turnover > 0) {
      const bonus = Math.min(30, (turnover / 500_000_000) * 30);
      score += bonus;
      reasons.push(`میانگین گردش حساب ماهانه (طبق پرینت بانکی): ${turnover.toLocaleString('en-US')} تومان`);
    } else {
      reasons.push('میانگین گردش حساب ثبت نشده — سقف اعتبار محتاطانه در نظر گرفته شد');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const computedLimit = Math.round(turnover * 0.3 * (score / 100));
    const creditLimit = contact.creditLimitOverride ?? computedLimit;

    return { score, creditLimit, basis: 'new', totalOutstanding, reasons };
  }

  private assessWithHistory(
    contact: { hasBouncedChecks: boolean; creditLimitOverride: number | null },
    invoices: Array<{
      status: string;
      total: number;
      dueAt: Date | null;
      payments: Array<{ paidAt: Date }>;
    }>,
    totalOutstanding: number,
  ): CreditAssessment {
    const now = new Date();
    let onTimeCount = 0;
    let earlyCount = 0;
    let overdueCount = 0;
    let completedCount = 0;
    let totalVolume = 0;

    for (const inv of invoices) {
      totalVolume += inv.total;
      if (inv.status === 'PAID') {
        completedCount++;
        const lastPaymentAt = inv.payments.reduce(
          (max, p) => (p.paidAt > max ? p.paidAt : max),
          new Date(0),
        );
        if (inv.dueAt) {
          if (lastPaymentAt <= inv.dueAt) {
            onTimeCount++;
            if (lastPaymentAt < inv.dueAt) earlyCount++;
          }
        } else {
          onTimeCount++;
        }
      } else if ((inv.status === 'CONFIRMED' || inv.status === 'PARTIALLY_PAID') && inv.dueAt && inv.dueAt < now) {
        overdueCount++;
      }
    }

    const reliabilityRate = completedCount > 0 ? onTimeCount / completedCount : 0.5;
    const earlyRate = completedCount > 0 ? earlyCount / completedCount : 0;

    const reliabilityScore = reliabilityRate * 40; // خوش‌حسابی — پرداخت در سررسید یا زودتر
    const volumeScore = Math.min(30, (totalVolume / 1_000_000_000) * 30); // حجم خرید
    const frequencyScore = Math.min(15, invoices.length * 1.5); // تعداد تکرار خرید
    const earlyBonus = earlyRate * 10; // تسویه پیش از موعد
    const overduePenalty = overdueCount * 15;
    const bouncedPenalty = contact.hasBouncedChecks ? 30 : 0;

    let score = reliabilityScore + volumeScore + frequencyScore + earlyBonus - overduePenalty - bouncedPenalty;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const avgInvoice = totalVolume / invoices.length;
    const multiplier = score >= 80 ? 3 : score >= 60 ? 2 : score >= 40 ? 1 : score >= 20 ? 0.5 : 0;
    const computedLimit = Math.round(avgInvoice * multiplier);
    const creditLimit = contact.creditLimitOverride ?? computedLimit;

    const reasons = [
      `نرخ پرداخت به‌موقع یا زودتر: ${Math.round(reliabilityRate * 100)}٪ از ${completedCount} فاکتور تسویه‌شده`,
      `حجم کل خرید: ${totalVolume.toLocaleString('en-US')} تومان در ${invoices.length} فاکتور`,
      overdueCount > 0 ? `${overdueCount} فاکتور معوق فعلی — ریسک را افزایش می‌دهد` : 'بدون فاکتور معوق فعلی',
      earlyRate > 0 ? `${Math.round(earlyRate * 100)}٪ فاکتورها پیش از موعد تسویه شده‌اند` : undefined,
      contact.hasBouncedChecks ? 'سابقه‌ی چک برگشتی ثبت شده' : undefined,
    ].filter((r): r is string => Boolean(r));

    return { score, creditLimit, basis: 'history', totalOutstanding, reasons };
  }
}
