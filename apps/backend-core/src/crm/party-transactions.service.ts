import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import type { CreatePartyTransactionDto } from './dto/create-party-transaction.dto.js';
import type { CreatePartyTransferDto } from './dto/create-party-transfer.dto.js';

const ACCOUNT = {
  RECEIVABLE: '1030',
  PAYABLE: '2010',
  DEFAULT_CASH: '1010',
};

/**
 * سند دریافت/پرداخت آزاد — برخلاف SalesPayment/PurchasePayment که به یک
 * فاکتور یا سفارش خاص وصل‌اند، این‌ها فقط بدهی/طلب کلی طرف‌حساب را از روی
 * حساب‌های دریافتنی/پرداختنی مشترک (۱۰۳۰/۲۰۱۰) تسویه می‌کنند — برای
 * پیش‌دریافت، تسویه‌ی کلی بدون فاکتور مشخص و مواردی از این دست.
 */
@Injectable()
export class PartyTransactionsService {
  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }

  async create(ctx: TenantRequestContext, partyId: string, dto: CreatePartyTransactionDto) {
    const party = await ctx.tenantDb.crmContact.findUnique({ where: { id: partyId } });
    if (!party) throw new NotFoundException('طرف‌حساب یافت نشد');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);

    const userId = await resolveTenantUserId(ctx);
    const cashAccount = await this.getAccount(ctx, dto.accountCode ?? ACCOUNT.DEFAULT_CASH);
    const subsidiaryAccount = await this.getAccount(
      ctx,
      dto.type === 'RECEIPT' ? ACCOUNT.RECEIVABLE : ACCOUNT.PAYABLE,
    );

    const journalLines =
      dto.type === 'RECEIPT'
        ? [
            { accountId: cashAccount.id, debit: BigInt(dto.amount), credit: BigInt(0) },
            { accountId: subsidiaryAccount.id, debit: BigInt(0), credit: BigInt(dto.amount) },
          ]
        : [
            { accountId: subsidiaryAccount.id, debit: BigInt(dto.amount), credit: BigInt(0) },
            { accountId: cashAccount.id, debit: BigInt(0), credit: BigInt(dto.amount) },
          ];

    const [entry, transaction] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `${dto.type === 'RECEIPT' ? 'دریافت' : 'پرداخت'} — ${party.name}${dto.note ? ` (${dto.note})` : ''}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: { create: journalLines },
        },
      }),
      ctx.tenantDb.partyTransaction.create({
        data: {
          partyId,
          type: dto.type,
          amount: dto.amount,
          accountCode: cashAccount.code,
          note: dto.note,
          createdByUserId: userId,
        },
      }),
    ]);

    await ctx.tenantDb.partyTransaction.update({ where: { id: transaction.id }, data: { journalEntryId: entry.id } });
    return transaction;
  }

  /**
   * تسویه‌ی مستقیم بین دو طرف‌حساب — وقتی بدهکار ما مستقیماً وجه را به
   * طلبکار ما پرداخت می‌کند (یا معادلش)، بدون این‌که پولی از حساب نقد/بانک
   * خودمان عبور کند. دقیقاً همان الگوی حسابداری پشت‌نویسی چک (بدهکار
   * حساب‌های پرداختنی/بستانکار حساب‌های دریافتنی)، اما مستقل از هر چک خاصی —
   * برای واریز مستقیم یا هر تسویه‌ی سه‌طرفه‌ی دیگر.
   */
  async transfer(ctx: TenantRequestContext, dto: CreatePartyTransferDto) {
    if (dto.fromContactId === dto.toContactId) {
      throw new BadRequestException('طرف بدهکار و طلبکار نمی‌توانند یکسان باشند');
    }
    const [fromParty, toParty] = await Promise.all([
      ctx.tenantDb.crmContact.findUnique({ where: { id: dto.fromContactId } }),
      ctx.tenantDb.crmContact.findUnique({ where: { id: dto.toContactId } }),
    ]);
    if (!fromParty) throw new NotFoundException('طرف‌حساب بدهکار یافت نشد');
    if (!toParty) throw new NotFoundException('طرف‌حساب طلبکار یافت نشد');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);

    const userId = await resolveTenantUserId(ctx);
    const receivable = await this.getAccount(ctx, ACCOUNT.RECEIVABLE);
    const payable = await this.getAccount(ctx, ACCOUNT.PAYABLE);
    const description = `تسویه‌ی مستقیم: ${fromParty.name} → ${toParty.name}${dto.note ? ` (${dto.note})` : ''}`;

    const [entry] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: payable.id, debit: BigInt(dto.amount), credit: BigInt(0) },
              { accountId: receivable.id, debit: BigInt(0), credit: BigInt(dto.amount) },
            ],
          },
        },
      }),
    ]);

    await ctx.tenantDb.partyTransaction.createMany({
      data: [
        {
          partyId: dto.fromContactId,
          type: 'RECEIPT',
          amount: dto.amount,
          accountCode: ACCOUNT.RECEIVABLE,
          note: `تسویه با پرداخت مستقیم به ${toParty.name}${dto.note ? ` — ${dto.note}` : ''}`,
          journalEntryId: entry.id,
          createdByUserId: userId,
        },
        {
          partyId: dto.toContactId,
          type: 'PAYMENT',
          amount: dto.amount,
          accountCode: ACCOUNT.PAYABLE,
          note: `تسویه با دریافت مستقیم از ${fromParty.name}${dto.note ? ` — ${dto.note}` : ''}`,
          journalEntryId: entry.id,
          createdByUserId: userId,
        },
      ],
    });

    return { success: true, journalEntryId: entry.id };
  }
}
