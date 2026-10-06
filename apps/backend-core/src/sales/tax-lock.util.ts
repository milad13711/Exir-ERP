import { BadRequestException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

/**
 * قفل فاکتور فروش وقتی صورتحساب الکترونیکی مودیان برای آن در جریان است (در انتظار تأیید، تأییدشده، در صف،
 * ارسال‌شده یا پذیرفته‌شده): ویرایش/حذف/ابطال فیلدهای مالیاتی ممنوع است تا JSON منجمدشده و آنچه به سازمان رفته
 * با فاکتور یکی بماند. مسیر درست: ابتدا از ماژول مالیات صورتحساب «ابطالی» بزنید و پس از پذیرش آن، فاکتور را باطل کنید.
 * وابستگی به ماژول tax عمداً فقط در سطح جدول است (ماژول فروش ماژول مالیات را import نمی‌کند).
 */
const LOCKING = ['PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENT', 'ACCEPTED'] as const;

export async function assertNotTaxLocked(db: TenantPrismaClient, salesInvoiceId: string, action: string): Promise<void> {
  const active = await db.taxInvoice.findFirst({
    where: { salesInvoiceId, status: { in: [...LOCKING] }, subject: { not: 'CANCELLATION' } },
    select: { id: true },
  });
  if (!active) return;
  // اگر ابطالیِ پذیرفته‌شده وجود دارد، صورتحساب مالیاتی خنثی شده و قفل برداشته می‌شود.
  const cancelled = await db.taxInvoice.findFirst({ where: { salesInvoiceId, subject: 'CANCELLATION', status: 'ACCEPTED' }, select: { id: true } });
  if (cancelled) return;
  throw new BadRequestException(`${action} ممکن نیست: صورتحساب الکترونیکی مالیاتی (مودیان) این فاکتور در جریان یا پذیرفته‌شده است؛ ابتدا از ماژول «مالیات و مودیان» صورتحساب ابطالی صادر کنید`);
}
