import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { accountBalance } from './balance.js';

/**
 * The three statements every real accountant expects from an ERP — beyond
 * the raw journal/ledger already exposed by AccountsController. All three
 * only consider POSTED entries; DRAFT entries have no financial effect yet.
 */
@Controller('accounting/reports')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class ReportsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** Every account's debit/credit turnover and ending balance, as of a date — should always balance (total debits = total credits). */
  @Get('trial-balance')
  async trialBalance(@Query('asOf') asOf: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const cutoff = asOf ? new Date(asOf) : new Date();

    const accounts = await ctx.tenantDb.account.findMany({
      include: {
        lines: {
          where: { entry: { status: 'POSTED', date: { lte: cutoff } } },
          select: { debit: true, credit: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    const rows = accounts.map((acc) => {
      const debit = acc.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const credit = acc.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      return {
        accountId: acc.id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        debit,
        credit,
        balance: accountBalance(acc.type, acc.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
      };
    });

    return {
      asOf: cutoff,
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    };
  }

  /** Revenue − Expense = Net Income, for a date range (defaults to the current Jalali-ish calendar year, i.e. the last 365 days). */
  @Get('income-statement')
  async incomeStatement(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 365 * 86_400_000);

    const accounts = await ctx.tenantDb.account.findMany({
      where: { type: { in: ['REVENUE', 'EXPENSE'] } },
      include: {
        lines: {
          where: { entry: { status: 'POSTED', date: { gte: fromDate, lte: toDate } } },
          select: { debit: true, credit: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    const revenueRows = accounts
      .filter((a) => a.type === 'REVENUE')
      .map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        amount: accountBalance('REVENUE', a.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
      }));
    const expenseRows = accounts
      .filter((a) => a.type === 'EXPENSE')
      .map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        amount: accountBalance('EXPENSE', a.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
      }));

    const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);

    return {
      from: fromDate,
      to: toDate,
      revenueRows,
      expenseRows,
      totalRevenue,
      totalExpense,
      netIncome: totalRevenue - totalExpense,
    };
  }

  /**
   * Assets = Liabilities + Equity, as of a date. Equity includes retained
   * earnings — net income since the beginning of time up to `asOf`, since
   * there's no period-close/carry-forward step in this system (every
   * revenue/expense account's lifetime balance IS the retained earnings).
   */
  @Get('balance-sheet')
  async balanceSheet(@Query('asOf') asOf: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const cutoff = asOf ? new Date(asOf) : new Date();

    const accounts = await ctx.tenantDb.account.findMany({
      include: {
        lines: {
          where: { entry: { status: 'POSTED', date: { lte: cutoff } } },
          select: { debit: true, credit: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    const toRow = (a: (typeof accounts)[number]) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      amount: accountBalance(a.type, a.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
    });

    const assetRows = accounts.filter((a) => a.type === 'ASSET').map(toRow);
    const liabilityRows = accounts.filter((a) => a.type === 'LIABILITY').map(toRow);
    const equityRows = accounts.filter((a) => a.type === 'EQUITY').map(toRow);
    const retainedEarnings = accounts
      .filter((a) => a.type === 'REVENUE' || a.type === 'EXPENSE')
      .reduce((sum, a) => sum + accountBalance(a.type, a.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))) * (a.type === 'REVENUE' ? 1 : -1), 0);

    const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
    const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
    const totalEquity = equityRows.reduce((s, r) => s + r.amount, 0) + retainedEarnings;

    return {
      asOf: cutoff,
      assetRows,
      liabilityRows,
      equityRows,
      retainedEarnings,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balances: totalAssets === totalLiabilities + totalEquity,
    };
  }
}
