import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { computeIncomeStatement, loadSums, sumFor, toNum, type AccountLite } from './period-reports.js';
import { getFiscalStartMonth } from './periods/accounting-settings.js';
import { resolvePeriod, type PeriodQuery } from './periods/jalali-periods.js';
import { lockedKeys } from './periods/period-lock.js';

@Controller('accounting/summary')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class AccountingSummaryController {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * کارت‌های بالای حسابداری. موجودی نقد تجمعی تا پایان دوره است؛ درآمد/هزینه/سود فقط برای دوره‌ی انتخابی
   * (پیش‌فرض: ماه جاری جلالی به وقت تهران). نام فیلدهای monthRevenue/monthExpense برای سازگاری حفظ شده‌اند.
   */
  @Get()
  async summary(@Query() q: PeriodQuery, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const startMonth = await getFiscalStartMonth(ctx.tenantDb);
    const period = resolvePeriod(q, { startMonth });

    const [accounts, upToEnd, inPeriod, draftCount] = await Promise.all([
      ctx.tenantDb.account.findMany({ select: { id: true, code: true, name: true, type: true, isCashAccount: true }, orderBy: { code: 'asc' } }),
      loadSums(ctx.tenantDb, { lt: period.toExclusive }),
      loadSums(ctx.tenantDb, { gte: period.from, lt: period.toExclusive }),
      ctx.tenantDb.journalEntry.count({ where: { status: 'DRAFT' } }),
    ]);

    let cashBalance = 0;
    for (const a of accounts) {
      if (!a.isCashAccount) continue;
      const s = sumFor(upToEnd, a.id);
      cashBalance += toNum(s.debit - s.credit);
    }
    const stmt = computeIncomeStatement(accounts as AccountLite[], inPeriod);
    const locked = period.key ? (await lockedKeys(ctx.tenantDb, [period.key])).has(period.key) : false;

    return {
      cashBalance,
      monthRevenue: stmt.totalRevenue,
      monthExpense: stmt.totalExpense,
      monthNetIncome: stmt.netIncome,
      monthGrossProfit: stmt.grossProfit,
      draftCount,
      period: { mode: period.mode, key: period.key, label: period.label, locked },
    };
  }
}
