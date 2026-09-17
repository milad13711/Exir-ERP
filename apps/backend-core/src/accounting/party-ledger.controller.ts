import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PartyStatementService } from '../crm/party-statement.service.js';
import { buildExcelBuffer } from '../common/excel.js';

const PARTY_BALANCE_EXCEL_HEADERS = ['نام', 'شرکت', 'تلفن', 'مانده'];
const STATEMENT_EXCEL_HEADERS = ['تاریخ', 'شرح', 'بدهکار (فروش)', 'بستانکار (خرید)'];

const KIND_LABELS: Record<string, string> = {
  SALES_INVOICE: 'فاکتور فروش',
  SALES_PAYMENT: 'دریافت وجه فروش',
  SALES_RETURN: 'مرجوعی فروش',
  PURCHASE_ORDER: 'سفارش خرید',
  PURCHASE_PAYMENT: 'پرداخت وجه خرید',
  PURCHASE_RETURN: 'مرجوعی خرید',
  PARTY_RECEIPT: 'دریافت وجه',
  PARTY_PAYMENT: 'پرداخت وجه',
  CHECK_RECEIVED: 'چک دریافتی',
  CHECK_ISSUED: 'چک صادرشده',
};

/**
 * لیست بدهکاران/بستانکاران و گردش‌حساب هر مخاطب، از دید ماژول حسابداری —
 * همان منطق PartyStatementService که CRM هم استفاده می‌کند (یک مدل واحد
 * طرف‌حساب)، اما زیر ماژول accounting تا تننت‌هایی که crm را فعال نکرده‌اند
 * هم بتوانند بدهکاران/بستانکاران‌شان را ببینند.
 */
@Controller('accounting/parties')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class PartyLedgerController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly partyStatement: PartyStatementService,
  ) {}

  private async balancesWithContacts(ctx: TenantRequestContext) {
    const balances = await this.partyStatement.allBalances(ctx);
    const contacts = await ctx.tenantDb.crmContact.findMany({
      where: { id: { in: [...balances.keys()] } },
      select: { id: true, name: true, company: true, phone: true },
    });
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const rows: Array<{ contact: (typeof contacts)[number]; arBalance: number; apBalance: number }> = [];
    for (const [id, balance] of balances) {
      const contact = byId.get(id);
      if (contact) rows.push({ contact, ...balance });
    }
    return rows;
  }

  @Get('receivables')
  async receivables(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    const rows = await this.balancesWithContacts(ctx);
    return rows
      .filter((r) => r.arBalance > 0)
      .map((r) => ({ ...r.contact, balance: r.arBalance }))
      .sort((a, b) => b.balance - a.balance);
  }

  /** apBalance > 0 یعنی به این تأمین‌کننده بدهکاریم (سفارش‌های تسویه‌نشده بیشتر از پرداختی‌ها) — همان علامتی که PartyStatementService.statement() برمی‌گرداند. */
  @Get('payables')
  async payables(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    const rows = await this.balancesWithContacts(ctx);
    return rows
      .filter((r) => r.apBalance > 0)
      .map((r) => ({ ...r.contact, balance: r.apBalance }))
      .sort((a, b) => b.balance - a.balance);
  }

  @Get('receivables/export')
  async exportReceivables(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'accounting');
    const rows = await this.balancesWithContacts(ctx);
    const buffer = await buildExcelBuffer(
      PARTY_BALANCE_EXCEL_HEADERS,
      rows
        .filter((r) => r.arBalance > 0)
        .sort((a, b) => b.arBalance - a.arBalance)
        .map((r) => ({ نام: r.contact.name, شرکت: r.contact.company ?? '', تلفن: r.contact.phone ?? '', مانده: r.arBalance })),
      'بدهکاران',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="receivables.xlsx"');
    res.send(buffer);
  }

  @Get('payables/export')
  async exportPayables(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'accounting');
    const rows = await this.balancesWithContacts(ctx);
    const buffer = await buildExcelBuffer(
      PARTY_BALANCE_EXCEL_HEADERS,
      rows
        .filter((r) => r.apBalance > 0)
        .sort((a, b) => b.apBalance - a.apBalance)
        .map((r) => ({ نام: r.contact.name, شرکت: r.contact.company ?? '', تلفن: r.contact.phone ?? '', مانده: r.apBalance })),
      'بستانکاران',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="payables.xlsx"');
    res.send(buffer);
  }

  @Get(':id/statement')
  async statement(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id }, select: { id: true, name: true, company: true, phone: true } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    const { lines, arBalance, apBalance } = await this.partyStatement.statement(ctx, id);
    return { contact, lines, arBalance, apBalance };
  }

  @Get(':id/statement/export')
  async exportStatement(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'accounting');
    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id }, select: { name: true } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    const { lines } = await this.partyStatement.statement(ctx, id);
    const buffer = await buildExcelBuffer(
      STATEMENT_EXCEL_HEADERS,
      lines.map((l) => ({
        تاریخ: l.date.toISOString().slice(0, 10),
        شرح: `${KIND_LABELS[l.kind] ?? l.kind} — ${l.description}`,
        'بدهکار (فروش)': l.arDelta || '',
        'بستانکار (خرید)': l.apDelta || '',
      })),
      'گردش حساب',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${contact.name}.xlsx"`);
    res.send(buffer);
  }
}
