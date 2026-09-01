import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { accountBalance } from '../accounting/balance.js';
import { currentStock } from '../warehouse/stock.js';

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

// The standard jalaali algorithm (leap-year break-point table) — an exact
// port of the verified implementation in web-panel's lib/persian.ts
// (toJalali). Kept in sync manually since backend/frontend are separate
// packages; only the Gregorian->Jalali direction is needed here, to bucket
// journal lines by Jalali year/month for the sales trend.
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}
const JALALI_BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = JALALI_BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn: number): { gy: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gm = mod(div(i, 153), 12) + 1;
  return { gy: div(j, 1461) - 100100 + div(8 - gm, 6) };
}
function toJalaliYearMonth(date: Date): { year: number; month: number } {
  const jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  let month: number;
  if (k >= 0) {
    if (k <= 185) return { year: jy, month: 1 + div(k, 31) };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  month = 7 + div(k, 30);
  return { year: jy, month };
}

@Injectable()
export class DashboardService {
  async summary(ctx: TenantRequestContext) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - 183 * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      cashAccounts,
      revenueLines,
      overdueInvoices,
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
      ctx.tenantDb.check.findMany({
        where: { status: { in: ['PENDING', 'DEPOSITED'] }, dueDate: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
        select: {
          id: true, direction: true, sayadId: true, amount: true, dueDate: true,
          contact: { select: { name: true, company: true } },
          supplier: { select: { name: true, company: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
      ctx.tenantDb.product.findMany({ include: { movements: { select: { quantityDelta: true } } } }),
      ctx.tenantDb.salesInvoice.count({ where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] }, confirmedAt: { gte: monthStart } } }),
    ]);

    const cashBalance = cashAccounts.reduce(
      (sum, acc) => sum + accountBalance(acc.type, acc.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
      0,
    );

    const overdueTotal = overdueInvoices.reduce((sum, inv) => sum + (inv.total - inv.paidAmount), 0);
    const overdueCountAll = await ctx.tenantDb.salesInvoice.count({
      where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueAt: { lt: now } },
    });

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

    return {
      cashBalance,
      monthInvoiceCount: monthConfirmedInvoiceCount,
      overdueReceivables: { total: overdueTotal, count: overdueCountAll, items: overdueInvoices },
      checksDueSoon: { total: checksDueSoonTotal, count: checksDueSoonCountAll, items: checksDueSoon },
      lowStockCount,
      salesTrend,
    };
  }
}
