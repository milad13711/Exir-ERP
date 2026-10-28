import type { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';

/**
 * آیا ماژول «حسابداری» برای این تننت فعال است؟ (همان منطق ModuleGuard: ردیف نصب INSTALLED/TRIAL، وگرنه isCore؛
 * وابستگی‌ها انتقالی.) ماژول فروش/فاکتور به حسابداری وابسته نیست: اگر نصب باشد، سندها مثل همیشه ثبت می‌شوند و
 * اگر نباشد، همه‌ی اثرهای حسابداری بی‌صدا نادیده گرفته می‌شود و فقط آرشیو فاکتورها (و انبار) کار می‌کند.
 *
 * اگر تشخیص ممکن نبود (خطای موقت دیتابیس کنترل)، «فعال» فرض می‌شود تا رفتار قبلی سیستم حفظ شود —
 * ثبت سند اضافه قابل جبران است، اما از دست رفتن سند مالی نه.
 */
export async function isAccountingActive(controlDb: ControlPrismaService, tenantId: string): Promise<boolean> {
  try {
    return await isModuleEnabled(controlDb, tenantId, 'accounting');
  } catch {
    return true;
  }
}

/** ثبت اسناد حسابداری فاکتور فروش: خطوط سند فروش (بدهکار دریافتنی / بستانکار درآمد و مالیات / بهای تمام‌شده). */
export const SALES_ACCOUNT = {
  CASH: '1010',
  BANK: '1020',
  RECEIVABLE: '1030',
  INVENTORY: '1040',
  TAX_PAYABLE: '2020',
  REVENUE: '4010',
  COGS: '5010',
} as const;

type AccountDb = { account: { findUnique(args: { where: { code: string } }): Promise<{ id: string } | null> } };

export class MissingAccountError extends Error {
  constructor(readonly code: string) {
    super(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
  }
}

export async function getSalesAccount(db: AccountDb, code: string): Promise<{ id: string }> {
  const account = await db.account.findUnique({ where: { code } });
  if (!account) throw new MissingAccountError(code);
  return account;
}

export type JournalLineInput = { accountId: string; debit: bigint; credit: bigint };

/**
 * سطرهای سند فروش: بدهکار حساب‌های دریافتنی به‌اندازه‌ی کل فاکتور / بستانکار درآمد (خالص از مالیات) /
 * بستانکار مالیات پرداختنی؛ و در صورت وجود بهای تمام‌شده: بدهکار بهای کالای فروش‌رفته / بستانکار موجودی کالا.
 * مبلغ فاکتور شامل مالیات است، اما درآمد شناسایی‌شده فقط جمع اقلام پس از تخفیف است.
 * تأیید فاکتور، ویرایش پس از تأیید و «ثبت اسناد فاکتورهای قبلی» همه از همین یک منبع استفاده می‌کنند.
 */
export async function buildSaleJournalLines(db: AccountDb, amounts: { total: number; taxAmount: number; cogsAmount: number }): Promise<JournalLineInput[]> {
  const receivable = await getSalesAccount(db, SALES_ACCOUNT.RECEIVABLE);
  const revenue = await getSalesAccount(db, SALES_ACCOUNT.REVENUE);
  const netRevenue = amounts.total - amounts.taxAmount;
  const lines: JournalLineInput[] = [
    { accountId: receivable.id, debit: BigInt(amounts.total), credit: BigInt(0) },
    { accountId: revenue.id, debit: BigInt(0), credit: BigInt(netRevenue) },
  ];
  if (amounts.taxAmount > 0) {
    const taxPayable = await getSalesAccount(db, SALES_ACCOUNT.TAX_PAYABLE);
    lines.push({ accountId: taxPayable.id, debit: BigInt(0), credit: BigInt(amounts.taxAmount) });
  }
  if (amounts.cogsAmount > 0) {
    const cogs = await getSalesAccount(db, SALES_ACCOUNT.COGS);
    const inventory = await getSalesAccount(db, SALES_ACCOUNT.INVENTORY);
    lines.push(
      { accountId: cogs.id, debit: BigInt(amounts.cogsAmount), credit: BigInt(0) },
      { accountId: inventory.id, debit: BigInt(0), credit: BigInt(amounts.cogsAmount) },
    );
  }
  return lines;
}

/** سطرهای سند دریافت وجه: بدهکار صندوق/بانک، بستانکار دریافتنی. */
export async function buildPaymentJournalLines(db: AccountDb, method: string, amount: number): Promise<JournalLineInput[]> {
  const cashAccount = await getSalesAccount(db, method === 'CASH' || method === 'POS' ? SALES_ACCOUNT.CASH : SALES_ACCOUNT.BANK);
  const receivable = await getSalesAccount(db, SALES_ACCOUNT.RECEIVABLE);
  return [
    { accountId: cashAccount.id, debit: BigInt(amount), credit: BigInt(0) },
    { accountId: receivable.id, debit: BigInt(0), credit: BigInt(amount) },
  ];
}

/** سطرهای سند مرجوعی فروش: برگشت درآمد و دریافتنی؛ و در صورت وجود بهای تمام‌شده، برگشت موجودی و بهای کالای فروش‌رفته. */
export async function buildReturnJournalLines(db: AccountDb, subtotal: number, cogsAmount: number): Promise<JournalLineInput[]> {
  const receivable = await getSalesAccount(db, SALES_ACCOUNT.RECEIVABLE);
  const revenue = await getSalesAccount(db, SALES_ACCOUNT.REVENUE);
  const lines: JournalLineInput[] = [
    { accountId: revenue.id, debit: BigInt(subtotal), credit: BigInt(0) },
    { accountId: receivable.id, debit: BigInt(0), credit: BigInt(subtotal) },
  ];
  if (cogsAmount > 0) {
    const cogs = await getSalesAccount(db, SALES_ACCOUNT.COGS);
    const inventory = await getSalesAccount(db, SALES_ACCOUNT.INVENTORY);
    lines.push(
      { accountId: inventory.id, debit: BigInt(cogsAmount), credit: BigInt(0) },
      { accountId: cogs.id, debit: BigInt(0), credit: BigInt(cogsAmount) },
    );
  }
  return lines;
}
