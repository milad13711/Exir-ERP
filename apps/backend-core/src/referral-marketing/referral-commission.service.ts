import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';

const COMMISSION_EXPENSE_ACCOUNT_CODE = '5040';
const PAYABLE_ACCOUNT_CODE = '2010';

/**
 * منطق مشترک محاسبه/ثبت کمیسیون — هم برای استفاده‌ی عمومی هر تننت
 * (کمیسیون خودکار وقتی فاکتور فروش یک مشتری معرفی‌شده تسویه می‌شود، از
 * InvoicesService) و هم برای تننت رجیستری پلتفرم (وقتی یک تننت جدید
 * exirerp پرداخت می‌کند، از ReferralSyncService). هر دو مسیر روی همان
 * ReferralConversion و همان مکانیزم حسابداری (PurchaseOrder واقعی) سوار
 * می‌شوند تا رفتار و گزارش‌گیری یکسان بماند.
 */
@Injectable()
export class ReferralCommissionService {
  /** یک مشتری CRM موجود در همین تننت را به یک نماینده وصل می‌کند — از این پس فاکتورهای تسویه‌شده‌ی این مشتری خودکار کمیسیون می‌سازند. */
  async linkContact(ctx: TenantRequestContext, resellerProfileId: string, contactId: string) {
    const [reseller, contact, existing] = await Promise.all([
      ctx.tenantDb.resellerProfile.findUnique({ where: { id: resellerProfileId } }),
      ctx.tenantDb.crmContact.findUnique({ where: { id: contactId } }),
      ctx.tenantDb.referralConversion.findUnique({ where: { contactId } }),
    ]);
    if (!reseller) throw new NotFoundException('نماینده یافت نشد');
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    if (existing) throw new ConflictException('این مخاطب قبلاً به یک نماینده وصل شده است');

    return ctx.tenantDb.referralConversion.create({
      data: { resellerProfileId, contactId },
      include: { contact: { select: { id: true, name: true, company: true, phone: true } } },
    });
  }

  /**
   * کمیسیون یک تراکنش را می‌بندد — اولین بار روی این مشتری/تننت به نرخ
   * «پرداخت اول»، دفعات بعدی به نرخ «تمدید» (بر اساس تعداد کمیسیون‌های
   * قبلی ثبت‌شده روی همین ReferralConversion، نه فاکتور کنترل‌پلین).
   */
  async bookCommission(
    tenantDb: TenantPrismaClient,
    conversionId: string,
    baseAmount: number,
    description: string,
  ): Promise<void> {
    const conversion = await tenantDb.referralConversion.findUnique({ where: { id: conversionId } });
    if (!conversion) return;

    const [reseller, priorCount] = await Promise.all([
      tenantDb.resellerProfile.findUniqueOrThrow({ where: { id: conversion.resellerProfileId } }),
      tenantDb.referralCommission.count({ where: { referralConversionId: conversionId } }),
    ]);

    const isFirstPayment = priorCount === 0;
    const percent = isFirstPayment ? reseller.commissionFirstPaymentPercent : reseller.commissionRenewalPercent;
    const amount = Math.round((baseAmount * percent) / 100);
    if (amount <= 0) return;

    await ensureDefaultChartOfAccounts(tenantDb);
    await this.ensureCommissionExpenseAccount(tenantDb);
    const [expenseAccount, payableAccount] = await Promise.all([
      tenantDb.account.findUniqueOrThrow({ where: { code: COMMISSION_EXPENSE_ACCOUNT_CODE } }),
      tenantDb.account.findUniqueOrThrow({ where: { code: PAYABLE_ACCOUNT_CODE } }),
    ]);

    const order = await tenantDb.purchaseOrder.create({
      data: {
        supplierId: reseller.contactId,
        status: 'RECEIVED',
        receivedAt: new Date(),
        subtotal: amount,
        total: amount,
        notes: description,
        lines: { create: [{ description, quantity: 1, unitCost: amount, lineTotal: amount }] },
      },
    });

    const entry = await tenantDb.journalEntry.create({
      data: {
        date: new Date(),
        description,
        status: 'POSTED',
        postedAt: new Date(),
        lines: {
          create: [
            { accountId: expenseAccount.id, debit: BigInt(amount), credit: BigInt(0) },
            { accountId: payableAccount.id, debit: BigInt(0), credit: BigInt(amount) },
          ],
        },
      },
    });

    await tenantDb.purchaseOrder.update({ where: { id: order.id }, data: { journalEntryId: entry.id } });
    await tenantDb.referralCommission.create({
      data: {
        referralConversionId: conversionId,
        kind: isFirstPayment ? 'FIRST_PAYMENT' : 'RENEWAL',
        purchaseOrderId: order.id,
        amount,
      },
    });
  }

  /** ensureDefaultChartOfAccounts فقط برای تننت‌های بدون هیچ حسابی seed می‌کند — این یک ردیف را برای تننت‌هایی که از قبل حساب دارند هم اضافه می‌کند، مطابق الگوی ensureDefaultWarehouse. */
  private async ensureCommissionExpenseAccount(tenantDb: TenantPrismaClient): Promise<void> {
    const existing = await tenantDb.account.findUnique({ where: { code: COMMISSION_EXPENSE_ACCOUNT_CODE } });
    if (existing) return;
    try {
      await tenantDb.account.create({
        data: { code: COMMISSION_EXPENSE_ACCOUNT_CODE, name: 'هزینه کمیسیون فروش/نمایندگی', type: 'EXPENSE', isSystem: true },
      });
    } catch (err) {
      const isUniqueConstraintViolation =
        typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
      if (!isUniqueConstraintViolation) throw err;
    }
  }
}
