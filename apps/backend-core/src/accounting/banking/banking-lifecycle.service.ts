import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../../common/request-context.js';

/**
 * حذف امن بانک / صندوق / دسته‌چک. حسابداری: هر چیزی که سند دفتر کل یا تراکنش دارد هرگز حذف نمی‌شود
 * (فقط غیرفعال؛ تراکنش با «ابطال» برمی‌گردد). حذف قطعی فقط برای مورد کاملاً بی‌سابقه است.
 */
@Injectable()
export class BankingLifecycleService {
  async deleteBank(ctx: TenantRequestContext, id: string) {
    const bank = await ctx.tenantDb.bankAccount.findUnique({ where: { id }, select: { id: true, name: true, openingEntryId: true } });
    if (!bank) throw new NotFoundException('حساب بانکی یافت نشد');
    const [tx, txIn, books] = await Promise.all([
      ctx.tenantDb.bankTransaction.count({ where: { bankAccountId: id } }),
      ctx.tenantDb.bankTransaction.count({ where: { toBankAccountId: id } }),
      ctx.tenantDb.chequeBook.count({ where: { bankAccountId: id } }),
    ]);
    if (tx + txIn > 0 || books > 0 || bank.openingEntryId) {
      throw new ConflictException(
        `حساب «${bank.name}» ${tx + txIn} تراکنش، ${books} دسته‌چک${bank.openingEntryId ? ' و سند افتتاحیه' : ''} دارد و حذف نمی‌شود (سوابق مالی ثابت‌اند). به‌جای حذف آن را غیرفعال کنید.`,
      );
    }
    await ctx.tenantDb.bankAccount.delete({ where: { id } });
    return { success: true };
  }

  async deleteCashBox(ctx: TenantRequestContext, id: string) {
    const box = await ctx.tenantDb.cashBox.findUnique({ where: { id }, select: { id: true, name: true, openingEntryId: true } });
    if (!box) throw new NotFoundException('صندوق یافت نشد');
    const [tx, txIn] = await Promise.all([
      ctx.tenantDb.bankTransaction.count({ where: { cashBoxId: id } }),
      ctx.tenantDb.bankTransaction.count({ where: { toCashBoxId: id } }),
    ]);
    if (tx + txIn > 0 || box.openingEntryId) {
      throw new ConflictException(
        `صندوق «${box.name}» ${tx + txIn} تراکنش${box.openingEntryId ? ' و سند افتتاحیه' : ''} دارد و حذف نمی‌شود (سوابق مالی ثابت‌اند). به‌جای حذف آن را غیرفعال کنید.`,
      );
    }
    await ctx.tenantDb.cashBox.delete({ where: { id } });
    return { success: true };
  }

  /** دسته‌چک فقط وقتی هیچ برگش مصرف/باطل/مفقود نشده حذف می‌شود؛ وگرنه «بستن». */
  async deleteChequeBook(ctx: TenantRequestContext, id: string) {
    const book = await ctx.tenantDb.chequeBook.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!book) throw new NotFoundException('دسته‌چک یافت نشد');
    const touched = await ctx.tenantDb.chequeLeaf.count({ where: { chequeBookId: id, OR: [{ status: { not: 'UNUSED' } }, { linkedCheckId: { not: null } }] } });
    if (touched > 0) {
      throw new ConflictException(`از دسته‌چک «${book.name}» ${touched} برگ استفاده/ثبت شده و حذف نمی‌شود. به‌جای حذف آن را ببندید.`);
    }
    await ctx.tenantDb.chequeBook.delete({ where: { id } }); // برگ‌ها cascade
    return { success: true };
  }
}
