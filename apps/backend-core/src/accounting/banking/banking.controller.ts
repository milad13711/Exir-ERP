import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../../common/guards/module.guard.js';
import { RequireModule } from '../../common/decorators/require-module.decorator.js';
import { Ctx } from '../../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { PermissionsService } from '../../permissions/permissions.service.js';
import type { PeriodQuery } from '../periods/jalali-periods.js';
import { BankingService } from './banking.service.js';
import {
  CreateBankAccountDto,
  CreateBankTransactionDto,
  CreateCashBoxDto,
  CreateChequeBookDto,
  SetLeafStatusDto,
  UpdateBankAccountDto,
  UpdateCashBoxDto,
  UpdateChequeBookDto,
  VoidBankTransactionDto,
} from './banking.dto.js';

/**
 * بانک‌ها و صندوق‌ها، دسته‌چک و تراکنش‌های خزانه — زیر ماتریس دسترسی ماژول «حسابداری»:
 * خواندن = «مشاهده‌ی همه» (مانده‌ها اطلاعات مالی‌اند)، ایجاد = ایجاد، ویرایش = ویرایش، ابطال تراکنش = حذف.
 */
@Controller('accounting/banking')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class BankingController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly banking: BankingService,
  ) {}

  // ── حساب‌های بانکی ──
  @Get('banks')
  async banks(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.listBanks(ctx);
  }

  @Post('banks')
  async createBank(@Body() dto: CreateBankAccountDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    return this.banking.createBank(ctx, dto);
  }

  @Put('banks/:id')
  async updateBank(@Param('id') id: string, @Body() dto: UpdateBankAccountDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    return this.banking.updateBank(ctx, id, dto);
  }

  @Get('banks/:id/statement')
  async bankStatement(@Param('id') id: string, @Query() q: PeriodQuery, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.statement(ctx, 'BANK', id, q);
  }

  @Get('banks/:id/balance')
  async bankBalance(@Param('id') id: string, @Query('asOf') asOf: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.balanceAsOf(ctx, 'BANK', id, asOf);
  }

  // ── صندوق ──
  @Get('cash-boxes')
  async cashBoxes(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.listCashBoxes(ctx);
  }

  @Post('cash-boxes')
  async createCashBox(@Body() dto: CreateCashBoxDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    return this.banking.createCashBox(ctx, dto);
  }

  @Post('cash-boxes/default')
  async defaultCashBox(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    return this.banking.ensureDefaultCashBox(ctx);
  }

  @Put('cash-boxes/:id')
  async updateCashBox(@Param('id') id: string, @Body() dto: UpdateCashBoxDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    return this.banking.updateCashBox(ctx, id, dto);
  }

  @Get('cash-boxes/:id/statement')
  async cashStatement(@Param('id') id: string, @Query() q: PeriodQuery, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.statement(ctx, 'CASH', id, q);
  }

  @Get('cash-boxes/:id/balance')
  async cashBalance(@Param('id') id: string, @Query('asOf') asOf: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.balanceAsOf(ctx, 'CASH', id, asOf);
  }

  // ── تراکنش‌ها ──
  @Get('transactions')
  async transactions(
    @Query() q: PeriodQuery & { bankAccountId?: string; cashBoxId?: string; type?: string; status?: string; limit?: string },
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.listTransactions(ctx, q);
  }

  @Post('transactions')
  async createTransaction(@Body() dto: CreateBankTransactionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    return this.banking.createTransaction(ctx, dto);
  }

  @Post('transactions/:id/void')
  async voidTransaction(@Param('id') id: string, @Body() dto: VoidBankTransactionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'accounting');
    return this.banking.voidTransaction(ctx, id, dto.reason.trim());
  }

  // ── دسته‌چک ──
  @Get('cheque-books')
  async chequeBooks(@Query('bankAccountId') bankAccountId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.listChequeBooks(ctx, bankAccountId);
  }

  /** برگ‌های مصرف‌نشده برای انتخاب هنگام صدور چک (مسیر ثابت پیش از :id). */
  @Get('cheque-books/available-leaves')
  async availableLeaves(@Query('bankAccountId') bankAccountId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    return this.banking.availableLeaves(ctx, bankAccountId);
  }

  @Get('cheque-books/:id')
  async chequeBook(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return this.banking.getChequeBook(ctx, id);
  }

  @Post('cheque-books')
  async createChequeBook(@Body() dto: CreateChequeBookDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    return this.banking.createChequeBook(ctx, dto);
  }

  @Put('cheque-books/:id')
  async updateChequeBook(@Param('id') id: string, @Body() dto: UpdateChequeBookDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    return this.banking.updateChequeBook(ctx, id, dto);
  }

  @Post('cheque-leaves/:id/status')
  async leafStatus(@Param('id') id: string, @Body() dto: SetLeafStatusDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    return this.banking.setLeafStatus(ctx, id, dto);
  }
}
