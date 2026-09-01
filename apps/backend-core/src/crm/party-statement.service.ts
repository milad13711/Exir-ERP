import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';

export type StatementLine = {
  date: Date;
  kind:
    | 'SALES_INVOICE'
    | 'SALES_PAYMENT'
    | 'SALES_RETURN'
    | 'PURCHASE_ORDER'
    | 'PURCHASE_PAYMENT'
    | 'PURCHASE_RETURN'
    | 'PARTY_RECEIPT'
    | 'PARTY_PAYMENT'
    | 'CHECK_RECEIVED'
    | 'CHECK_ISSUED';
  description: string;
  /** مثبت = افزایش طلب ما از این طرف (AR) یا کاهش بدهی ما به او؛ منفی = برعکس — ببینید arDelta/apDelta */
  arDelta: number;
  apDelta: number;
  refId: string;
};

/**
 * گردش حساب یکپارچه‌ی یک طرف‌حساب — چون از یکی‌سازی مشتری/تأمین‌کننده،
 * یک CrmContact می‌تواند هم مدیون ما باشد (AR، از فروش) هم ما مدیون او
 * باشیم (AP، از خرید)؛ این دو مانده جدا محاسبه می‌شوند، اما در یک جدول
 * زمانی واحد نمایش داده می‌شوند.
 */
@Injectable()
export class PartyStatementService {
  async statement(ctx: TenantRequestContext, partyId: string) {
    const [invoices, payments, salesReturns, orders, purchasePayments, purchaseReturns, partyTransactions, checks] =
      await Promise.all([
        ctx.tenantDb.salesInvoice.findMany({
          where: { contactId: partyId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { id: true, invoiceNo: true, total: true, confirmedAt: true, issuedAt: true },
        }),
        ctx.tenantDb.salesPayment.findMany({
          where: { invoice: { contactId: partyId } },
          select: { id: true, amount: true, paidAt: true, invoice: { select: { invoiceNo: true } } },
        }),
        ctx.tenantDb.salesReturn.findMany({
          where: { invoice: { contactId: partyId } },
          select: { id: true, total: true, createdAt: true, invoice: { select: { invoiceNo: true } } },
        }),
        ctx.tenantDb.purchaseOrder.findMany({
          where: { supplierId: partyId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { id: true, orderNo: true, total: true, receivedAt: true, issuedAt: true },
        }),
        ctx.tenantDb.purchasePayment.findMany({
          where: { order: { supplierId: partyId } },
          select: { id: true, amount: true, paidAt: true, order: { select: { orderNo: true } } },
        }),
        ctx.tenantDb.purchaseReturn.findMany({
          where: { order: { supplierId: partyId } },
          select: { id: true, total: true, createdAt: true, order: { select: { orderNo: true } } },
        }),
        ctx.tenantDb.partyTransaction.findMany({ where: { partyId } }),
        ctx.tenantDb.check.findMany({
          where: { contactId: partyId },
          select: { id: true, direction: true, sayadId: true, amount: true, status: true, dueDate: true, createdAt: true },
        }),
      ]);

    const lines: StatementLine[] = [
      ...invoices.map((i) => ({
        date: i.confirmedAt ?? i.issuedAt,
        kind: 'SALES_INVOICE' as const,
        description: `فاکتور فروش #${i.invoiceNo}`,
        arDelta: i.total,
        apDelta: 0,
        refId: i.id,
      })),
      ...payments.map((p) => ({
        date: p.paidAt,
        kind: 'SALES_PAYMENT' as const,
        description: `دریافت وجه فاکتور #${p.invoice.invoiceNo}`,
        arDelta: -p.amount,
        apDelta: 0,
        refId: p.id,
      })),
      ...salesReturns.map((r) => ({
        date: r.createdAt,
        kind: 'SALES_RETURN' as const,
        description: `مرجوعی فاکتور #${r.invoice.invoiceNo}`,
        arDelta: -r.total,
        apDelta: 0,
        refId: r.id,
      })),
      ...orders.map((o) => ({
        date: o.receivedAt ?? o.issuedAt,
        kind: 'PURCHASE_ORDER' as const,
        description: `سفارش خرید #${o.orderNo}`,
        arDelta: 0,
        apDelta: o.total,
        refId: o.id,
      })),
      ...purchasePayments.map((p) => ({
        date: p.paidAt,
        kind: 'PURCHASE_PAYMENT' as const,
        description: `پرداخت وجه سفارش #${p.order.orderNo}`,
        arDelta: 0,
        apDelta: -p.amount,
        refId: p.id,
      })),
      ...purchaseReturns.map((r) => ({
        date: r.createdAt,
        kind: 'PURCHASE_RETURN' as const,
        description: `مرجوعی سفارش #${r.order.orderNo}`,
        arDelta: 0,
        apDelta: -r.total,
        refId: r.id,
      })),
      ...partyTransactions.map((t) => ({
        date: t.createdAt,
        kind: t.type === 'RECEIPT' ? ('PARTY_RECEIPT' as const) : ('PARTY_PAYMENT' as const),
        description: t.note ?? (t.type === 'RECEIPT' ? 'دریافت وجه' : 'پرداخت وجه'),
        arDelta: t.type === 'RECEIPT' ? -t.amount : 0,
        apDelta: t.type === 'PAYMENT' ? -t.amount : 0,
        refId: t.id,
      })),
      ...checks.map((c) => ({
        date: c.createdAt,
        kind: c.direction === 'RECEIVED' ? ('CHECK_RECEIVED' as const) : ('CHECK_ISSUED' as const),
        description: `چک ${c.direction === 'RECEIVED' ? 'دریافتی' : 'صادرشده'} به شماره صیادی ${c.sayadId} (${c.status})`,
        arDelta: 0,
        apDelta: 0,
        refId: c.id,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    const arBalance = lines.reduce((sum, l) => sum + l.arDelta, 0);
    const apBalance = lines.reduce((sum, l) => sum + l.apDelta, 0);

    return { lines, arBalance, apBalance };
  }
}
