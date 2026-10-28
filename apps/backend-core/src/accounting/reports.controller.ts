import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import {
  buildComparison,
  computeBalanceSheet,
  computeIncomeStatement,
  computeTrialBalance,
  loadSums,
  sumFor,
  toNum,
  type AccountLite,
} from './period-reports.js';
import {
  currentJalaliMonth,
  fiscalYearMonths,
  fiscalYearOf,
  fiscalYearRange,
  isFarFuture,
  jalaliMonthRange,
  monthLabel,
  monthsEndingAt,
  parsePeriodKey,
  periodKey,
  resolveAsOf,
  resolvePeriod,
  shiftMonth,
  type PeriodQuery,
  type ResolvedPeriod,
} from './periods/jalali-periods.js';
import { getFiscalStartMonth } from './periods/accounting-settings.js';
import { lockedKeys } from './periods/period-lock.js';

type ReportQuery = PeriodQuery;

/**
 * گزارش‌های مالی دوره‌ای. همه‌ی گزارش‌ها فقط اسناد POSTED را می‌شمارند.
 * پارامترها (به‌ترتیب اولویت): from/to (تاریخ میلادی یا ISO؛ «to» شامل همان روز) ← period=YYYY-MM (ماه جلالی) ←
 * period=all (تجمیعی) ← fiscalYear=YYYY ← پیش‌فرض: ماه جاری جلالی (وقت تهران).
 */
@Controller('accounting/reports')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class ReportsController {
  constructor(private readonly permissions: PermissionsService) {}

  private async prepare(ctx: TenantRequestContext, q: ReportQuery) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const startMonth = await getFiscalStartMonth(ctx.tenantDb);
    // سازگاری با نسخه‌ی قبل: فقط asOf = تجمیعی تا آن تاریخ
    const effective: ReportQuery = q.asOf && !q.period && !q.fiscalYear && !q.from && !q.to ? { to: q.asOf } : q;
    const period = resolvePeriod(effective, { startMonth });
    const accounts = (await ctx.tenantDb.account.findMany({
      select: { id: true, code: true, name: true, type: true, isCashAccount: true },
      orderBy: { code: 'asc' },
    })) as AccountLite[];
    return { startMonth, period, accounts };
  }

  private async periodMeta(ctx: TenantRequestContext, p: ResolvedPeriod) {
    const locked = p.key ? (await lockedKeys(ctx.tenantDb, [p.key])).has(p.key) : false;
    return {
      mode: p.mode,
      key: p.key,
      label: p.label,
      from: p.from,
      to: isFarFuture(p.toExclusive) ? null : new Date(p.toExclusive.getTime() - 1),
      fiscalYear: p.fiscalYear,
      locked,
    };
  }

  /** ستون‌ها: مانده‌ی ابتدای دوره، گردش بدهکار/بستانکار دوره، مانده‌ی پایان دوره. */
  @Get('trial-balance')
  async trialBalance(@Query() q: ReportQuery, @Ctx() ctx: TenantRequestContext) {
    const { period, accounts } = await this.prepare(ctx, q);
    const [allBefore, fiscalPre, inPeriod] = await Promise.all([
      loadSums(ctx.tenantDb, { lt: period.from }),
      loadSums(ctx.tenantDb, { gte: period.fiscalYearStart, lt: period.from }),
      loadSums(ctx.tenantDb, { gte: period.from, lt: period.toExclusive }),
    ]);
    const tb = computeTrialBalance(accounts, allBefore, fiscalPre, inPeriod);
    return {
      period: await this.periodMeta(ctx, period),
      asOf: isFarFuture(period.toExclusive) ? new Date() : new Date(period.toExclusive.getTime() - 1),
      ...tb,
    };
  }

  /** درآمد، بهای تمام‌شده، هزینه‌ها، سود ناخالص و خالص برای دوره‌ی انتخابی (فقط همان دوره). */
  @Get('income-statement')
  async incomeStatement(@Query() q: ReportQuery, @Ctx() ctx: TenantRequestContext) {
    const { period, accounts } = await this.prepare(ctx, q);
    const sums = await loadSums(ctx.tenantDb, { gte: period.from, lt: period.toExclusive });
    return {
      period: await this.periodMeta(ctx, period),
      from: period.from,
      to: isFarFuture(period.toExclusive) ? new Date() : new Date(period.toExclusive.getTime() - 1),
      ...computeIncomeStatement(accounts, sums),
    };
  }

  /** ترازنامه ذاتاً تجمعی است: وضعیت در پایان دوره (یا asOf). سود دوره جاری و سال‌های قبل جدا نشان داده می‌شود. */
  @Get('balance-sheet')
  async balanceSheet(@Query() q: ReportQuery, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const startMonth = await getFiscalStartMonth(ctx.tenantDb);
    const { asOfExclusive, label } = resolveAsOf(q, { startMonth });
    const accounts = (await ctx.tenantDb.account.findMany({
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    })) as AccountLite[];
    // ابتدای سال مالیِ شامل تاریخ پایان
    const asOfInstant = new Date(asOfExclusive.getTime() - 1);
    const fyStart = fiscalYearRange(fiscalYearOf(asOfInstant, startMonth), startMonth).from;
    const [allToAsOf, fiscalToAsOf] = await Promise.all([
      loadSums(ctx.tenantDb, { lt: asOfExclusive }),
      loadSums(ctx.tenantDb, { gte: fyStart, lt: asOfExclusive }),
    ]);
    return { asOf: asOfInstant, asOfLabel: label, ...computeBalanceSheet(accounts, allToAsOf, fiscalToAsOf) };
  }

  /** خلاصه‌ی گردش بانک و صندوق در دوره: مانده‌ی ابتدا، ورودی، خروجی، مانده‌ی پایان به‌تفکیک هر حساب نقدی/بانکی. */
  @Get('cash-movement')
  async cashMovement(@Query() q: ReportQuery, @Ctx() ctx: TenantRequestContext) {
    const { period, accounts } = await this.prepare(ctx, q);
    const cash = accounts.filter((a) => a.isCashAccount);
    const [before, inPeriod, banks, boxes] = await Promise.all([
      loadSums(ctx.tenantDb, { lt: period.from }),
      loadSums(ctx.tenantDb, { gte: period.from, lt: period.toExclusive }),
      ctx.tenantDb.bankAccount.findMany({ select: { id: true, name: true, linkedAccountId: true } }),
      ctx.tenantDb.cashBox.findMany({ select: { id: true, name: true, linkedAccountId: true } }),
    ]);
    const holder = new Map<string, { kind: 'BANK' | 'CASH_BOX'; id: string; name: string }>();
    for (const b of banks) holder.set(b.linkedAccountId, { kind: 'BANK', id: b.id, name: b.name });
    for (const c of boxes) holder.set(c.linkedAccountId, { kind: 'CASH_BOX', id: c.id, name: c.name });
    const rows = cash.map((a) => {
      const b = sumFor(before, a.id);
      const p = sumFor(inPeriod, a.id);
      const opening = toNum(b.debit - b.credit);
      const inflow = toNum(p.debit);
      const outflow = toNum(p.credit);
      const h = holder.get(a.id);
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        holder: h ?? null,
        opening,
        inflow,
        outflow,
        net: inflow - outflow,
        closing: opening + inflow - outflow,
      };
    });
    const sum = (k: 'opening' | 'inflow' | 'outflow' | 'closing') => rows.reduce((s, r) => s + r[k], 0);
    return {
      period: await this.periodMeta(ctx, period),
      rows,
      totals: { opening: sum('opening'), inflow: sum('inflow'), outflow: sum('outflow'), net: sum('inflow') - sum('outflow'), closing: sum('closing') },
    };
  }

  /**
   * مقایسه‌ی ماه‌ها (حداکثر ۲۴ ماه): months=1405-06,1405-07 یا end=1405-07&count=6 یا fiscalYear=1405 (۱۲ ماه سال مالی).
   * yoy=1: همان ماه‌ها در سال قبل (اگر داده‌ای باشد).
   */
  @Get('compare')
  async compare(
    @Query('months') monthsParam: string | undefined,
    @Query('end') end: string | undefined,
    @Query('count') count: string | undefined,
    @Query('fiscalYear') fiscalYear: string | undefined,
    @Query('yoy') yoy: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const startMonth = await getFiscalStartMonth(ctx.tenantDb);

    let list: Array<{ year: number; month: number }>;
    if (monthsParam) {
      list = monthsParam.split(',').map((s) => parsePeriodKey(s));
      if (list.length < 1 || list.length > 24) throw new BadRequestException('تعداد ماه‌های مقایسه باید بین ۱ تا ۲۴ باشد');
      list.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
    } else if (fiscalYear) {
      const fy = Number(fiscalYear);
      if (!Number.isInteger(fy) || fy < 1300 || fy > 1600) throw new BadRequestException('سال مالی نامعتبر است');
      list = fiscalYearMonths(fy, startMonth).map((m) => ({ year: m.year, month: m.month }));
    } else {
      const endYm = end ? parsePeriodKey(end) : currentJalaliMonth();
      const n = Math.min(24, Math.max(1, Number(count) || 6));
      list = monthsEndingAt(endYm, n);
    }

    const accounts = (await ctx.tenantDb.account.findMany({
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    })) as AccountLite[];

    const load = async (ym: { year: number; month: number }) => {
      const r = jalaliMonthRange(ym.year, ym.month);
      return { key: periodKey(ym.year, ym.month), label: monthLabel(ym.year, ym.month), sums: await loadSums(ctx.tenantDb, { gte: r.from, lt: r.toExclusive }) };
    };
    const months = await Promise.all(list.map(load));
    const comparison = buildComparison(accounts, months);
    const locks = await lockedKeys(ctx.tenantDb, months.map((m) => m.key));

    let yoyBlock: Array<{ key: string; label: string; hasData: boolean; revenue: number; expense: number; netIncome: number; revenueChange: number | null; netIncomeChange: number | null }> | null = null;
    if (yoy === '1' || yoy === 'true') {
      const prev = await Promise.all(list.map((ym) => load(shiftMonth(ym, -12))));
      const prevCmp = buildComparison(accounts, prev);
      yoyBlock = prevCmp.months.map((m, i) => {
        const cur = comparison.months[i];
        const hasData = prev[i].sums.size > 0;
        return {
          key: m.key,
          label: m.label,
          hasData,
          revenue: m.revenue,
          expense: m.expense,
          netIncome: m.netIncome,
          revenueChange: hasData && m.revenue !== 0 ? Math.round(((cur.revenue - m.revenue) / Math.abs(m.revenue)) * 1000) / 10 : null,
          netIncomeChange: hasData && m.netIncome !== 0 ? Math.round(((cur.netIncome - m.netIncome) / Math.abs(m.netIncome)) * 1000) / 10 : null,
        };
      });
    }

    return {
      months: comparison.months.map((m) => ({ ...m, locked: locks.has(m.key) })),
      totals: comparison.totals,
      accountRows: comparison.accountRows,
      yoy: yoyBlock,
    };
  }
}

