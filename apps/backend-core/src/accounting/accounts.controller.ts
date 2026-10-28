import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
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
import { UpdateAccountDto } from './dto/update-account.dto.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { accountBalance } from './balance.js';
import { computeLedger, loadSums, natural, sumFor, toNum, type AccountType as PrAccountType } from './period-reports.js';
import { getFiscalStartMonth } from './periods/accounting-settings.js';
import { resolvePeriod, type PeriodQuery } from './periods/jalali-periods.js';

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

  /**
   * بدون پارامتر: مانده‌ی تجمعی همه‌ی زمان‌ها (رفتار قبلی). با period=YYYY-MM / fiscalYear / from / to:
   * برای حساب‌های ترازنامه‌ای مانده‌ی پایان دوره و برای درآمد/هزینه فقط گردش همان دوره.
   */
  @Get()
  async list(@Query() q: PeriodQuery, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    if (q.period || q.fiscalYear || q.from || q.to) {
      const period = resolvePeriod(q, { startMonth: await getFiscalStartMonth(ctx.tenantDb) });
      const [accounts, upToEnd, inPeriod] = await Promise.all([
        ctx.tenantDb.account.findMany({ orderBy: { code: 'asc' } }),
        loadSums(ctx.tenantDb, { lt: period.toExclusive }),
        loadSums(ctx.tenantDb, { gte: period.from, lt: period.toExclusive }),
      ]);
      return accounts.map((account) => {
        const pnl = account.type === 'REVENUE' || account.type === 'EXPENSE';
        const s = sumFor(pnl ? inPeriod : upToEnd, account.id);
        return { ...account, balance: natural(account.type as PrAccountType, s.debit - s.credit) };
      });
    }
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

  /** ویرایش کدینگ حساب — تغییر کد حساب‌های پیش‌فرض سیستم مجاز نیست چون ماژول‌های دیگر (مثل دارایی ثابت) با کد به آن‌ها ارجاع می‌دهند. */
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const account = await ctx.tenantDb.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('حساب یافت نشد');
    if (dto.code && dto.code !== account.code) {
      if (account.isSystem) throw new ConflictException('کد حساب‌های پیش‌فرض سیستم قابل تغییر نیست');
      const existing = await ctx.tenantDb.account.findUnique({ where: { code: dto.code } });
      if (existing) throw new ConflictException('حسابی با این کد از قبل وجود دارد');
    }
    if (dto.type && dto.type !== account.type) {
      if (account.isSystem) throw new ConflictException('نوع حساب‌های پیش‌فرض سیستم قابل تغییر نیست');
      // تغییر نوع حسابِ دارای گردش، ماهیت مانده و گزارش‌های مالی (ترازنامه/سود و زیان) قبلی را بی‌صدا عوض می‌کند
      const lineCount = await ctx.tenantDb.journalLine.count({ where: { accountId: id } });
      if (lineCount > 0) throw new ConflictException('این حساب در اسناد حسابداری گردش دارد و نوع آن قابل تغییر نیست');
    }
    return ctx.tenantDb.account.update({
      where: { id },
      data: {
        ...(dto.code ? { code: dto.code } : {}),
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.isCashAccount !== undefined ? { isCashAccount: dto.isCashAccount } : {}),
      },
    });
  }

  /** حذف فقط وقتی مجاز است که حساب پیش‌فرض سیستم نباشد و هیچ سند/بودجه/ردیف مغایرت‌گیری‌ای به آن وصل نباشد. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'accounting');
    const account = await ctx.tenantDb.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('حساب یافت نشد');
    if (account.isSystem) throw new ConflictException('حساب‌های پیش‌فرض سیستم حذف نمی‌شوند');
    const [lineCount, budgetLineCount, statementLineCount] = await Promise.all([
      ctx.tenantDb.journalLine.count({ where: { accountId: id } }),
      ctx.tenantDb.budgetLine.count({ where: { accountId: id } }),
      ctx.tenantDb.bankStatementLine.count({ where: { accountId: id } }),
    ]);
    if (lineCount > 0 || budgetLineCount > 0 || statementLineCount > 0) {
      throw new ConflictException('این حساب در سند، بودجه یا مغایرت‌گیری استفاده شده و حذف نمی‌شود');
    }
    await ctx.tenantDb.account.delete({ where: { id } });
    return { success: true };
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

  /**
   * دفتر حساب. بدون پارامتر کل تاریخچه (opening=0)؛ با period/fiscalYear/from/to فقط ردیف‌های آن بازه، با «مانده‌ی ابتدای دوره»
   * (حساب‌های ترازنامه‌ای: مانده‌ی تجمعی قبل از شروع؛ درآمد/هزینه: از ابتدای سال مالی) و مانده‌ی جاری ردیف‌به‌ردیف.
   */
  @Get(':id/ledger')
  async ledger(@Param('id') id: string, @Query() q: PeriodQuery, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    const account = await ctx.tenantDb.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('حساب یافت نشد');
    const period = resolvePeriod(q, { startMonth: await getFiscalStartMonth(ctx.tenantDb), defaultMode: 'all' });
    const pnl = account.type === 'REVENUE' || account.type === 'EXPENSE';

    const [before, lines] = await Promise.all([
      ctx.tenantDb.journalLine.aggregate({
        where: { accountId: id, entry: { status: 'POSTED', date: { gte: pnl ? period.fiscalYearStart : new Date(0), lt: period.from } } },
        _sum: { debit: true, credit: true },
      }),
      ctx.tenantDb.journalLine.findMany({
        where: { accountId: id, entry: { status: 'POSTED', date: { gte: period.from, lt: period.toExclusive } } },
        include: { entry: { select: { number: true, date: true, description: true } } },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
      }),
    ]);
    const openingNet = (before._sum.debit ?? 0n) - (before._sum.credit ?? 0n);
    const ledger = computeLedger(
      account.type as PrAccountType,
      openingNet,
      lines.map((l) => ({
        id: l.id,
        entryNumber: l.entry.number,
        date: l.entry.date,
        description: l.description ?? l.entry.description,
        debit: toNum(l.debit),
        credit: toNum(l.credit),
      })),
    );
    return {
      account: { ...account, balance: ledger.closing },
      period: { mode: period.mode, key: period.key, label: period.label },
      openingBalance: ledger.opening,
      closingBalance: ledger.closing,
      totalDebit: ledger.totalDebit,
      totalCredit: ledger.totalCredit,
      rows: ledger.rows,
    };
  }
}
