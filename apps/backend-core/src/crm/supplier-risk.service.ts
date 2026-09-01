import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { PartyStatementService } from './party-statement.service.js';

export type SupplierRiskAssessment = {
  score: number; // ۰ تا ۱۰۰ — هرچه بالاتر، رابطه‌ی خرید با این تأمین‌کننده سالم‌تر است
  basis: 'new' | 'history';
  totalOutstanding: number; // مانده‌ی بدهی ما به این تأمین‌کننده (AP)
  reasons: string[];
};

const DAY_MS = 86_400_000;

/**
 * سنجه‌ی سمت خرید (AP) — آینه‌ی CreditScoreService که سمت فروش (AR) را
 * می‌سنجد. آن سرویس می‌گوید «چقدر می‌توانیم به این مشتری اعتبار بدهیم»؛
 * این یکی می‌گوید «رابطه‌ی خرید ما با این تأمین‌کننده چقدر سالم است» —
 * یعنی ما به‌عنوان خریدار چقدر قابل‌اتکا بوده‌ایم (پرداخت به‌موقع، بدون
 * چک برگشتی به او)، نه اینکه او به ما چقدر اعتبار بدهد. بر خلاف
 * CreditScoreService، هیچ «سقف اعتبار» محاسبه نمی‌شود — چون چنین مفهومی
 * (سقفی که تأمین‌کننده به ما می‌دهد) در این سیستم ثبت نمی‌شود و ساختنش از
 * صفر گمراه‌کننده بود؛ فقط یک امتیاز و دلایل شفاف برمی‌گردد.
 *
 * PurchaseOrder برخلاف SalesInvoice فیلد سررسید پرداخت ندارد (فقط
 * expectedAt دارد که تاریخ تحویل مورد انتظار است، نه مهلت پرداخت) — پس
 * «به‌موقع بودن» با یک آستانه‌ی ثابت (۳۰ روز از صدور سفارش تا تسویه‌ی
 * نهایی) تقریب زده می‌شود، نه با مقایسه با یک سررسید واقعی.
 */
@Injectable()
export class SupplierRiskService {
  constructor(private readonly partyStatement: PartyStatementService) {}

  async assess(ctx: TenantRequestContext, supplierId: string): Promise<SupplierRiskAssessment> {
    const orders = await ctx.tenantDb.purchaseOrder.findMany({
      where: { supplierId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      include: { payments: { select: { amount: true, paidAt: true } } },
    });

    const { apBalance } = await this.partyStatement.statement(ctx, supplierId);
    const totalOutstanding = Math.max(0, apBalance);

    const bouncedIssuedChecks = await ctx.tenantDb.check.count({
      where: { contactId: supplierId, direction: 'ISSUED', status: 'BOUNCED' },
    });

    if (orders.length === 0) {
      const reasons = ['بدون سابقه‌ی سفارش خرید از این تأمین‌کننده'];
      let score = 50;
      if (bouncedIssuedChecks > 0) {
        score -= 40;
        reasons.push(`${bouncedIssuedChecks} فقره چک برگشتی صادرشده به این تأمین‌کننده`);
      }
      return { score: Math.max(0, Math.min(100, score)), basis: 'new', totalOutstanding, reasons };
    }

    const now = new Date();
    let paidCount = 0;
    let promptCount = 0; // تسویه‌ی کامل ظرف ۳۰ روز از صدور سفارش
    let staleUnpaidCount = 0; // بیش از ۴۵ روز از صدور گذشته و هنوز تسویه نشده
    let totalVolume = 0;

    for (const order of orders) {
      totalVolume += order.total;
      if (order.status === 'PAID') {
        paidCount++;
        const lastPaymentAt = order.payments.reduce(
          (max, p) => (p.paidAt > max ? p.paidAt : max),
          new Date(0),
        );
        if (lastPaymentAt.getTime() - order.issuedAt.getTime() <= 30 * DAY_MS) {
          promptCount++;
        }
      } else if (now.getTime() - order.issuedAt.getTime() > 45 * DAY_MS) {
        staleUnpaidCount++;
      }
    }

    const reliabilityRate = paidCount > 0 ? promptCount / paidCount : 0.5;
    const reliabilityScore = reliabilityRate * 40;
    const volumeScore = Math.min(30, (totalVolume / 1_000_000_000) * 30);
    const frequencyScore = Math.min(15, orders.length * 1.5);
    const completionBonus = (paidCount / orders.length) * 15;
    const stalePenalty = staleUnpaidCount * 15;
    const bouncedPenalty = bouncedIssuedChecks > 0 ? 30 : 0;

    let score = reliabilityScore + volumeScore + frequencyScore + completionBonus - stalePenalty - bouncedPenalty;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const reasons = [
      `پرداخت ظرف ۳۰ روز از صدور سفارش: ${Math.round(reliabilityRate * 100)}٪ از ${paidCount} سفارش تسویه‌شده`,
      `حجم کل خرید: ${totalVolume.toLocaleString('en-US')} تومان در ${orders.length} سفارش`,
      staleUnpaidCount > 0
        ? `${staleUnpaidCount} سفارش بیش از ۴۵ روز است تسویه نشده — ریسک را افزایش می‌دهد`
        : 'بدون سفارش معوق طولانی‌مدت',
      bouncedIssuedChecks > 0 ? `${bouncedIssuedChecks} فقره چک برگشتی صادرشده به این تأمین‌کننده` : undefined,
    ].filter((r): r is string => Boolean(r));

    return { score, basis: 'history', totalOutstanding, reasons };
  }
}
