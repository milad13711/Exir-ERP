import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { accountBalance } from './balance.js';

@Controller('accounting/summary')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class AccountingSummaryController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async summary(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [cashAccounts, monthLines, draftCount] = await Promise.all([
      ctx.tenantDb.account.findMany({
        where: { isCashAccount: true },
        include: { lines: { where: { entry: { status: 'POSTED' } }, select: { debit: true, credit: true } } },
      }),
      ctx.tenantDb.journalLine.findMany({
        where: { entry: { status: 'POSTED', date: { gte: monthStart } } },
        include: { account: { select: { type: true } } },
      }),
      ctx.tenantDb.journalEntry.count({ where: { status: 'DRAFT' } }),
    ]);

    const cashBalance = cashAccounts.reduce(
      (sum, acc) =>
        sum + accountBalance(acc.type, acc.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))),
      0,
    );

    const monthRevenue = monthLines
      .filter((l) => l.account.type === 'REVENUE')
      .reduce((sum, l) => sum + (Number(l.credit) - Number(l.debit)), 0);
    const monthExpense = monthLines
      .filter((l) => l.account.type === 'EXPENSE')
      .reduce((sum, l) => sum + (Number(l.debit) - Number(l.credit)), 0);

    return { cashBalance, monthRevenue, monthExpense, draftCount };
  }
}
