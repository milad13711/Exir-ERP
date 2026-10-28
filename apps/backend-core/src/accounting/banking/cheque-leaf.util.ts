import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../../generated/tenant-client/index.js';

export const LEAF_STATUSES = ['UNUSED', 'ISSUED', 'CLEARED', 'BOUNCED', 'VOID', 'LOST'] as const;
export type LeafStatus = (typeof LEAF_STATUSES)[number];

type Db = Pick<TenantPrismaClient, 'chequeLeaf' | 'chequeBook'>;

/** وضعیت برگ چک متناظر با وضعیت چک. چک ثبت‌شده/واگذارشده به بانک هنوز «صادرشده» است. */
export function leafStatusForCheck(checkStatus: string): LeafStatus | null {
  switch (checkStatus) {
    case 'PENDING':
    case 'DEPOSITED':
      return 'ISSUED';
    case 'CLEARED':
      return 'CLEARED';
    case 'BOUNCED':
      return 'BOUNCED';
    case 'CANCELLED':
      return 'VOID';
    default:
      return null;
  }
}

/**
 * یک برگ را برای چکِ صادرشده رزرو می‌کند: برگ مشخص، یا (با chequeBookId) کوچک‌ترین سریالِ مصرف‌نشده.
 * رزرو با updateMany شرطی انجام می‌شود تا دو صدور همزمان یک برگ را نگیرند.
 */
export async function claimLeaf(
  db: Db,
  sel: { chequeLeafId?: string; chequeBookId?: string },
  checkId: string,
): Promise<{ leafId: string; serial: number; bankName: string | null; bankAccountId: string }> {
  if (!sel.chequeLeafId && !sel.chequeBookId) throw new BadRequestException('دسته‌چک یا برگ چک را مشخص کنید');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const leaf = sel.chequeLeafId
      ? await db.chequeLeaf.findUnique({ where: { id: sel.chequeLeafId }, include: { chequeBook: { include: { bankAccount: true } } } })
      : await db.chequeLeaf.findFirst({
          where: { chequeBookId: sel.chequeBookId, status: 'UNUSED', chequeBook: { status: 'ACTIVE' } },
          orderBy: { serial: 'asc' },
          include: { chequeBook: { include: { bankAccount: true } } },
        });
    if (!leaf) throw new ConflictException('برگ مصرف‌نشده‌ای در این دسته‌چک نمانده است');
    if (leaf.chequeBook.status !== 'ACTIVE') throw new ConflictException('این دسته‌چک فعال نیست');
    if (!leaf.chequeBook.bankAccount.isActive) throw new ConflictException('حساب بانکی این دسته‌چک غیرفعال است');
    if (leaf.status !== 'UNUSED') {
      if (sel.chequeLeafId) throw new ConflictException('این برگ چک قبلاً مصرف شده یا باطل/مفقود است');
      continue;
    }
    const res = await db.chequeLeaf.updateMany({
      where: { id: leaf.id, status: 'UNUSED' },
      data: { status: 'ISSUED', linkedCheckId: checkId, updatedAt: new Date() },
    });
    if (res.count === 1) {
      await refreshBookStatus(db, leaf.chequeBookId);
      return { leafId: leaf.id, serial: leaf.serial, bankName: leaf.chequeBook.bankAccount.bankName, bankAccountId: leaf.chequeBook.bankAccountId };
    }
  }
  throw new ConflictException('برگ چک همزمان توسط کاربر دیگری مصرف شد؛ دوباره تلاش کنید');
}

/** همگام‌سازی وضعیت برگِ وصل‌شده به چک؛ اگر چک برگی ندارد بی‌اثر است. */
export async function syncLeafWithCheck(db: Db, checkId: string, checkStatus: string): Promise<void> {
  const next = leafStatusForCheck(checkStatus);
  if (!next) return;
  await db.chequeLeaf.updateMany({ where: { linkedCheckId: checkId }, data: { status: next, updatedAt: new Date() } });
}

/** دسته‌چک بدون برگ مصرف‌نشده «تمام‌شده» است؛ اگر برگی آزاد شد دوباره فعال می‌شود (مگر بسته‌شده باشد). */
export async function refreshBookStatus(db: Db, chequeBookId: string): Promise<void> {
  const book = await db.chequeBook.findUnique({ where: { id: chequeBookId }, select: { status: true } });
  if (!book || book.status === 'CLOSED') return;
  const unused = await db.chequeLeaf.count({ where: { chequeBookId, status: 'UNUSED' } });
  const next = unused === 0 ? 'EXHAUSTED' : 'ACTIVE';
  if (next !== book.status) await db.chequeBook.update({ where: { id: chequeBookId }, data: { status: next } });
}
