import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { accountBalance } from './balance.js';

@Controller('accounting/accounts')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class AccountsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const accounts = await ctx.tenantDb.account.findMany({
      include: { lines: { where: { entry: { status: 'POSTED' } }, select: { debit: true, credit: true } } },
      orderBy: { code: 'asc' },
    });
    return accounts.map(({ lines, ...account }) => ({
      ...account,
      balance: accountBalance(
        account.type,
        lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) })),
      ),
    }));
  }

  @Post()
  async create(@Body() dto: CreateAccountDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    const existing = await ctx.tenantDb.account.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('حسابی با این کد از قبل وجود دارد');
    return ctx.tenantDb.account.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        isCashAccount: dto.isCashAccount ?? false,
      },
    });
  }

  @Get(':id/ledger')
  async ledger(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    const account = await ctx.tenantDb.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('حساب یافت نشد');

    const lines = await ctx.tenantDb.journalLine.findMany({
      where: { accountId: id, entry: { status: 'POSTED' } },
      include: { entry: { select: { number: true, date: true, description: true } } },
      orderBy: { entry: { date: 'asc' } },
    });

    let running = 0;
    const sign = account.type === 'ASSET' || account.type === 'EXPENSE' ? 1 : -1;
    const rows = lines.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      running += sign * (debit - credit);
      return {
        id: l.id,
        entryNumber: l.entry.number,
        date: l.entry.date,
        description: l.description ?? l.entry.description,
        debit,
        credit,
        runningBalance: running,
      };
    });

    return { account: { ...account, balance: running }, rows };
  }
}
