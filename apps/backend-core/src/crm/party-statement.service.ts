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

  /**
   * Same deltas as `statement()`, computed for every party at once (tenant-
   * wide queries instead of one round-trip per contact) — the debtors/
   * creditors list needs every contact's balance, not one contact's ledger.
   * Checks are omitted on purpose: they never carry an arDelta/apDelta
   * above either (see `statement()`), so they can't move a balance.
   */
  async allBalances(ctx: TenantRequestContext): Promise<Map<string, { arBalance: number; apBalance: number }>> {
    const [invoices, payments, salesReturns, orders, purchasePayments, purchaseReturns, partyTransactions] =
      await Promise.all([
        ctx.tenantDb.salesInvoice.findMany({
          where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { contactId: true, total: true },
        }),
        ctx.tenantDb.salesPayment.findMany({ select: { amount: true, invoice: { select: { contactId: true } } } }),
        ctx.tenantDb.salesReturn.findMany({ select: { total: true, invoice: { select: { contactId: true } } } }),
        ctx.tenantDb.purchaseOrder.findMany({
          where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { supplierId: true, total: true },
        }),
        ctx.tenantDb.purchasePayment.findMany({ select: { amount: true, order: { select: { supplierId: true } } } }),
        ctx.tenantDb.purchaseReturn.findMany({ select: { total: true, order: { select: { supplierId: true } } } }),
        ctx.tenantDb.partyTransaction.findMany({ select: { partyId: true, amount: true, type: true } }),
      ]);

    const balances = new Map<string, { arBalance: number; apBalance: number }>();
    const bump = (id: string, ar: number, ap: number) => {
      const cur = balances.get(id) ?? { arBalance: 0, apBalance: 0 };
      cur.arBalance += ar;
      cur.apBalance += ap;
      balances.set(id, cur);
    };

    for (const i of invoices) bump(i.contactId, i.total, 0);
    for (const p of payments) bump(p.invoice.contactId, -p.amount, 0);
    for (const r of salesReturns) bump(r.invoice.contactId, -r.total, 0);
    for (const o of orders) bump(o.supplierId, 0, o.total);
    for (const p of purchasePayments) bump(p.order.supplierId, 0, -p.amount);
    for (const r of purchaseReturns) bump(r.order.supplierId, 0, -r.total);
    for (const t of partyTransactions) {
      bump(t.partyId, t.type === 'RECEIPT' ? -t.amount : 0, t.type === 'PAYMENT' ? -t.amount : 0);
    }

    return balances;
  }
}
