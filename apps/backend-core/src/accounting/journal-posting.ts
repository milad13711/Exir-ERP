import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { assertPeriodOpen } from './periods/period-lock.js';

export type PostingLine = { accountId: string; debit: bigint; credit: bigint; description?: string | null };

/** مبالغ باید عدد صحیح (تومان) باشند؛ مجموع بدهکار = بستانکار > ۰ و هر ردیف فقط یک طرف. */
export function assertBalancedLines(lines: PostingLine[]): bigint {
  if (lines.length < 2) throw new BadRequestException('سند حداقل دو ردیف دارد');
  let d = 0n;
  let c = 0n;
  for (const l of lines) {
    if (l.debit < 0n || l.credit < 0n) throw new BadRequestException('مبلغ ردیف سند نمی‌تواند منفی باشد');
    if (l.debit > 0n && l.credit > 0n) throw new BadRequestException('هر ردیف سند فقط می‌تواند بدهکار یا بستانکار باشد، نه هر دو');
    d += l.debit;
    c += l.credit;
  }
  if (d !== c) throw new BadRequestException('مجموع بدهکار و بستانکار سند باید برابر باشد');
  if (d === 0n) throw new BadRequestException('مبلغ سند نمی‌تواند صفر باشد');
  return d;
}

type Tx = Pick<TenantPrismaClient, 'journalEntry' | 'accountingPeriodLock'>;
type ReverseTx = Tx & Pick<TenantPrismaClient, 'bankStatementLine'>;

/** ثبت قطعی یک سند متوازن (با کنترل قفل دوره). برای استفاده در تراکنش، `tx` را بدهید. */
export async function postJournalEntry(
  db: Tx,
  input: { date: Date; description: string; lines: PostingLine[]; createdByUserId?: string | null; reversalOfId?: string },
) {
  assertBalancedLines(input.lines);
  await assertPeriodOpen(db, input.date);
  return db.journalEntry.create({
    data: {
      date: input.date,
      description: input.description,
      status: 'POSTED',
      postedAt: new Date(),
      createdByUserId: input.createdByUserId ?? undefined,
      reversalOfId: input.reversalOfId,
      lines: { create: input.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? undefined })) },
    },
  });
}

/** ابطال با سند معکوس (هرگز حذف). تاریخ سند معکوس «اکنون» است و باید در دوره‌ی باز باشد؛ تاریخ سند اصلی هم نباید قفل باشد. */
export async function reverseJournalEntry(
  db: ReverseTx,
  entryId: string,
  reason: string,
  userId: string | null,
): Promise<{ id: string }> {
  const entry = await db.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
  if (!entry) throw new ConflictException('سند حسابداری یافت نشد');
  if (entry.status !== 'POSTED') throw new ConflictException('فقط سند قطعی‌شده ابطال می‌شود');
  if (entry.voidedAt) throw new ConflictException('این سند قبلاً باطل شده است');
  if (entry.reversalOfId) throw new ConflictException('سند معکوس را نمی‌توان دوباره باطل کرد');
  await assertPeriodOpen(db, entry.date);
  // سطری که با صورت‌حساب بانکی تطبیق (reconcile) خورده با ابطال سند از زیر تطبیق در می‌رود
  const reconciled = await db.bankStatementLine.count({ where: { matchedJournalLine: { entryId: entry.id } } });
  if (reconciled > 0) throw new ConflictException('یکی از ردیف‌های این سند با صورت‌حساب بانکی تطبیق داده شده است؛ ابتدا تطبیق را بردارید، سپس سند را باطل کنید');
  const now = new Date();
  // ادعای اتمیک: دو ابطال هم‌زمان فقط یکی برنده می‌شود (باید داخل تراکنش فراخوانی شود تا در صورت شکست برگردد)
  const claim = await db.journalEntry.updateMany({ where: { id: entry.id, status: 'POSTED', voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
  if (claim.count !== 1) throw new ConflictException('این سند هم‌زمان توسط کاربر دیگری باطل شد');
  const reversal = await postJournalEntry(db, {
    date: now,
    description: `ابطال سند شماره ${entry.number}: ${reason}`,
    lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })),
    createdByUserId: userId,
    reversalOfId: entry.id,
  });
  return reversal;
}

/** ثبت ردپای حسابرسی (ActivityLog) برای عملیات حسابداری. */
export async function auditAccounting(
  ctx: TenantRequestContext,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
  summary?: string,
): Promise<void> {
  await ctx.tenantDb.activityLog.create({
    data: { userId, action, entityType, entityId, metadata: metadata as never, moduleCode: 'accounting', summary: summary ?? null },
  });
}
