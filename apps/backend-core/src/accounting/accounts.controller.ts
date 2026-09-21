import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { accountBalance } from './balance.js';

const ACCOUNT_EXCEL_HEADERS = ['کد', 'نام', 'نوع', 'حساب نقدی'];

const ACCOUNT_TYPE_TO_FA: Record<string, string> = {
  ASSET: 'دارایی',
  LIABILITY: 'بدهی',
  EQUITY: 'حقوق صاحبان سهام',
  REVENUE: 'درآمد',
  EXPENSE: 'هزینه',
};
const ACCOUNT_TYPE_FROM_FA: Record<string, string> = Object.fromEntries(
  Object.entries(ACCOUNT_TYPE_TO_FA).map(([en, fa]) => [fa, en]),
);

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

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'accounting');
    const accounts = await ctx.tenantDb.account.findMany({ orderBy: { code: 'asc' } });
    const buffer = await buildExcelBuffer(
      ACCOUNT_EXCEL_HEADERS,
      accounts.map((a) => ({
        کد: a.code,
        نام: a.name,
        نوع: ACCOUNT_TYPE_TO_FA[a.type] ?? a.type,
        'حساب نقدی': a.isCashAccount ? 'بلی' : 'خیر',
      })),
      'کدینگ حساب‌ها',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="accounts.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'accounting');
    const buffer = await buildExcelBuffer(
      ACCOUNT_EXCEL_HEADERS,
      [{ کد: '1101', نام: 'صندوق', نوع: 'دارایی', 'حساب نقدی': 'بلی' }],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="accounts-template.xlsx"');
    res.send(buffer);
  }

  /** Upserts by کد: an existing code updates that account, a new one creates it. Rows with an unrecognized نوع are skipped. */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const code = String(row['کد'] ?? '').trim();
      const name = String(row['نام'] ?? '').trim();
      if (!code || !name) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'کد یا نام خالی است' });
        continue;
      }
      const type = ACCOUNT_TYPE_FROM_FA[String(row['نوع'] ?? '').trim()];
      if (!type) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نوع حساب نامعتبر است' });
        continue;
      }
      const data = { name, type: type as never, isCashAccount: String(row['حساب نقدی'] ?? '').trim() === 'بلی' };

      const existing = await ctx.tenantDb.account.findUnique({ where: { code } });
      if (existing) {
        await ctx.tenantDb.account.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.account.create({ data: { code, ...data } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Get(':id/ledger')
  async ledger(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
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
