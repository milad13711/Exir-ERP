import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { accountBalance } from '../accounting/balance.js';
import { currentStock } from '../warehouse/stock.js';
import { computeProducibleOutputQty } from '../production/production-capacity.js';
import { computeCustomerFollowUps } from '../crm/purchase-pattern.js';
import { JALALI_MONTHS, toJalaliYearMonth } from '../common/jalali.js';

@Injectable()
export class DashboardService {
  async summary(ctx: TenantRequestContext) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - 183 * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86_400_000);

    const [
      cashAccounts,
      revenueLines,
      overdueInvoices,
      dueOrOverdueInvoicesRaw,
      checksDueSoon,
      products,
      monthConfirmedInvoiceCount,
    ] = await Promise.all([
      ctx.tenantDb.account.findMany({
        where: { isCashAccount: true },
        include: { lines: { where: { entry: { status: 'POSTED' } }, select: { debit: true, credit: true } } },
      }),
      ctx.tenantDb.journalLine.findMany({
        where: { entry: { status: 'POSTED', date: { gte: sixMonthsAgo } }, account: { type: 'REVENUE' } },
        select: { debit: true, credit: true, entry: { select: { date: true } } },
      }),
      ctx.tenantDb.salesInvoice.findMany({
        where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueAt: { lt: now } },
        select: { id: true, invoiceNo: true, total: true, paidAmount: true, dueAt: true, contact: { select: { name: true, company: true } } },
        orderBy: { dueAt: 'asc' },
        take: 5,
      }),
      // برای ویجت «فاکتورهای نزدیک به سررسید و معوق» — هم معوق (سررسید گذشته) و
      // هم نزدیک به سررسید (تا ۷ روز آینده) در یک کوئری، چون بازه‌ی هر دو زیرمجموعه‌ی
      // «تا ۷ روز دیگر» است؛ فیلتر مرجوعی‌شده‌ها بعداً روی همین نتیجه انجام می‌شود
      // (همان منطق hasReturn که فهرست فاکتورهای فروش استفاده می‌کند).
      ctx.tenantDb.salesInvoice.findMany({
        where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueAt: { not: null, lte: sevenDaysFromNow } },
        select: {
          id: true, invoiceNo: true, total: true, paidAmount: true, dueAt: true,
          contact: { select: { id: true, name: true, company: true, phone: true } },
          _count: { select: { returns: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: 15,
      }),
      ctx.tenantDb.check.findMany({
        where: { status: { in: ['PENDING', 'DEPOSITED'] }, dueDate: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
        select: {
          id: true, direction: true, sayadId: true, amount: true, dueDate: true,
          contact: { select: { name: true, company: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
      ctx.tenantDb.product.findMany({ include: { movements: { select: { quantityDelta: true } } } }),
      ctx.tenantDb.salesInvoice.count({ where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] }, confirmedAt: { gte: monthStart } } }),
    ]);

    // «ظرفیت تولید فعلی» — فقط اگر ماژول تولید واقعاً استفاده شده (حداقل یک
    // فرمول فعال دارد)؛ موجودی کل روی همه‌ی انبارها جمع می‌شود (نه هر انبار
    // جدا) چون این فقط یک ویجت خلاصه‌ی داشبورد است.
    const boms = await ctx.tenantDb.billOfMaterial.findMany({
      where: { isActive: true },
      include: { outputProduct: { select: { id: true, name: true, unit: true } }, lines: { include: { rawMaterial: { select: { name: true } } } } },
    });
    const stockByProductId = new Map(products.map((p) => [p.id, currentStock(p.movements)]));
    const producibleCapacity = boms.map((bom) => {
      const lines = bom.lines.map((l) => ({
        quantityPerBatch: l.quantityPerBatch,
        availableStock: stockByProductId.get(l.rawMaterialProductId) ?? 0,
      }));
      const producibleQty = computeProducibleOutputQty(bom.batchOutputQty, lines);
      const bottleneck = bom.lines.find(
        (l) => (stockByProductId.get(l.rawMaterialProductId) ?? 0) < l.quantityPerBatch,
      );
      return {
        productId: bom.outputProduct.id,
        productName: bom.outputProduct.name,
        unit: bom.outputProduct.unit,
        producibleQty,
        bottleneckMaterial: producibleQty === 0 ? (bottleneck?.rawMaterial.name ?? null) : null,
      };
    });

    const cashBalance = cashAccounts.reduce(
      (sum, acc) => sum + accountBalance(acc.type, acc.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
      0,
    );

    const overdueTotal = overdueInvoices.reduce((sum, inv) => sum + (inv.total - inv.paidAmount), 0);
    const overdueCountAll = await ctx.tenantDb.salesInvoice.count({
      where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueAt: { lt: now } },
    });

    // hasReturn: فاکتور مرجوعی‌شده در این ویجت نمایش داده نمی‌شود — همان قاعده‌ای
    // که فهرست فاکتورهای فروش برای وضعیت درست‌تر استفاده می‌کند (invoices.service.ts:list).
    const dueOrOverdueInvoices = dueOrOverdueInvoicesRaw
      .filter((inv) => inv._count.returns === 0)
      .map(({ _count, dueAt, ...inv }) => ({
        ...inv,
        dueAt: dueAt!,
        daysDiff: Math.ceil((dueAt!.getTime() - now.getTime()) / 86_400_000),
      }));

    const checksDueSoonTotal = checksDueSoon.reduce((sum, c) => sum + c.amount, 0);
    const checksDueSoonCountAll = await ctx.tenantDb.check.count({
      where: { status: { in: ['PENDING', 'DEPOSITED'] }, dueDate: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
    });

    let lowStockCount = 0;
    for (const { movements, ...product } of products) {
      const stock = currentStock(movements);
      if (product.reorderPoint > 0 && stock <= product.reorderPoint) lowStockCount += 1;
    }

    // Bucket the last 6 months of revenue journal lines by Jalali month.
    const buckets = new Map<string, number>();
    const orderedKeys: string[] = [];
    // Step back in JALALI month units, not Gregorian ones — the two
    // calendars' month boundaries don't align (Jalali years start ~March
    // 21), so walking back N Gregorian months and converting each 1st-of-
    // month to Jalali silently drops the current Jalali month whenever
    // "today" falls in the second half of its Gregorian counterpart.
    const { year: currentJy, month: currentJm } = toJalaliYearMonth(now);
    for (let i = 5; i >= 0; i--) {
      let month = currentJm - i;
      let year = currentJy;
      while (month <= 0) {
        month += 12;
        year -= 1;
      }
      const key = `${year}-${month}`;
      buckets.set(key, 0);
      orderedKeys.push(key);
    }
    for (const line of revenueLines) {
      const { year, month } = toJalaliYearMonth(line.entry.date);
      const key = `${year}-${month}`;
      if (!buckets.has(key)) continue;
      buckets.set(key, (buckets.get(key) ?? 0) + (Number(line.credit) - Number(line.debit)));
    }
    const salesTrend = orderedKeys.map((key) => {
      const month = Number(key.split('-')[1]);
      return { label: JALALI_MONTHS[month - 1], value: buckets.get(key) ?? 0 };
    });

    // روند تولید ۶ ماه اخیر + همان ماه‌ها در سال قبل برای مقایسه — بازه‌ی
    // واکشی سخاوتمندانه (۲۰ ماه میلادی) تا هر دو سال جلالی را پوشش دهد،
    // چون مرز سال جلالی/میلادی یکی نیست.
    const twentyMonthsAgo = new Date(now.getTime() - 610 * 86_400_000);
    const completedOrders = await ctx.tenantDb.productionOrder.findMany({
      where: { status: 'COMPLETED', actualEndAt: { gte: twentyMonthsAgo } },
      select: { quantityProduced: true, actualEndAt: true },
    });
    const productionBuckets = new Map<string, number>();
    for (const o of completedOrders) {
      if (!o.actualEndAt || !o.quantityProduced) continue;
      const { year, month } = toJalaliYearMonth(o.actualEndAt);
      const key = `${year}-${month}`;
      productionBuckets.set(key, (productionBuckets.get(key) ?? 0) + o.quantityProduced);
    }
    const productionTrend = orderedKeys.map((key) => {
      const [yearStr, monthStr] = key.split('-');
      const lastYearKey = `${Number(yearStr) - 1}-${monthStr}`;
      return {
        label: JALALI_MONTHS[Number(monthStr) - 1],
        value: productionBuckets.get(key) ?? 0,
        valueLastYear: productionBuckets.get(lastYearKey) ?? 0,
      };
    });

    // مشتریانی که موعد سفارش مجدد (طبق ریتم خرید خودشان، نه یک آستانه‌ی
    // ثابت) گذشته — فقط از فاکتورهای واقعا صادرشده (نه پیش‌نویس) و حداکثر
    // دو سال اخیر، تا الگوی قدیمی/متروک باعث یادآوری بی‌مورد نشود.
    const twoYearsAgo = new Date(now.getTime() - 730 * 86_400_000);
    const invoiceLines = await ctx.tenantDb.salesInvoiceLine.findMany({
      where: {
        productId: { not: null },
        invoice: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] }, issuedAt: { gte: twoYearsAgo } },
      },
      select: {
        productId: true,
        invoice: { select: { issuedAt: true, contactId: true, contact: { select: { name: true, company: true } } } },
      },
    });
    const purchaseLines = invoiceLines
      .filter((l): l is typeof l & { productId: string } => !!l.productId)
      .map((l) => ({
        contactId: l.invoice.contactId,
        contactName: l.invoice.contact.company || l.invoice.contact.name,
        productId: l.productId,
        productName: '',
        issuedAt: l.invoice.issuedAt,
      }));
    const productIds = [...new Set(purchaseLines.map((l) => l.productId))];
    const productNames = await ctx.tenantDb.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
    const productNameById = new Map(productNames.map((p) => [p.id, p.name]));
    const customerFollowUps = computeCustomerFollowUps(
      purchaseLines.map((l) => ({ ...l, productName: productNameById.get(l.productId) ?? '' })),
      now,
    ).slice(0, 8);

    return {
      cashBalance,
      monthInvoiceCount: monthConfirmedInvoiceCount,
      overdueReceivables: { total: overdueTotal, count: overdueCountAll, items: overdueInvoices },
      dueOrOverdueInvoices,
      checksDueSoon: { total: checksDueSoonTotal, count: checksDueSoonCountAll, items: checksDueSoon },
      lowStockCount,
      producibleCapacity,
      salesTrend,
      productionTrend,
      customerFollowUps,
    };
  }
}
