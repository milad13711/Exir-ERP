import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { assertPeriodOpen } from '../accounting/periods/period-lock.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { CostingService } from '../warehouse/costing.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { buildReturnJournalLines, isAccountingActive, MissingAccountError } from './accounting-link.js';
import type { CreateSalesReturnDto } from './dto/create-sales-return.dto.js';

const RETURN_INCLUDE = {
  invoice: { select: { id: true, invoiceNo: true, contactId: true } },
  lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly costing: CostingService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.salesReturn.findMany({
      include: {
        invoice: { select: { id: true, invoiceNo: true, contact: { select: { id: true, name: true, company: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const ret = await ctx.tenantDb.salesReturn.findUnique({ where: { id }, include: RETURN_INCLUDE });
    if (!ret) throw new NotFoundException('مرجوعی فروش یافت نشد');
    return ret;
  }

  private static keyOf(l: { productId?: string | null; description: string }) {
    return l.productId ?? `desc:${l.description}`;
  }

  /**
   * سقف مرجوعی هر ردیف: مقدار آن در فاکتور، منهای مقدار قبلاً مرجوع‌شده‌اش —
   * مجموع مرجوعی‌های یک ردیف هرگز نباید از مقدار خریداری‌شده‌اش بیشتر شود.
   * کالاهای دارای productId با شناسه‌شان کلید می‌شوند؛ ردیف‌های آزاد بدون
   * کالا (مثلاً خدمات) با شرح‌شان — تنها کلید پایدار موجود برای آن‌ها.
   * هم در create() برای اعتبارسنجی سرور و هم در returnable() برای تعیین
   * اینکه دکمه‌ی «ثبت مرجوعی» در کلاینت باید نمایش داده شود یا نه، استفاده می‌شود.
   */
  private async remainingByLine(
    ctx: TenantRequestContext,
    invoiceId: string,
    invoiceLines: Array<{ productId: string | null; description: string; quantity: number }>,
  ): Promise<Map<string, number>> {
    const priorReturns = await ctx.tenantDb.salesReturnLine.findMany({
      where: { return: { invoiceId } },
    });
    const alreadyReturned = new Map<string, number>();
    for (const l of priorReturns) {
      const key = SalesReturnsService.keyOf(l);
      alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + l.quantity);
    }
    const invoicedQty = new Map<string, number>();
    for (const l of invoiceLines) {
      const key = SalesReturnsService.keyOf(l);
      invoicedQty.set(key, (invoicedQty.get(key) ?? 0) + l.quantity);
    }
    const remaining = new Map<string, number>();
    for (const [key, max] of invoicedQty) {
      remaining.set(key, Math.max(0, max - (alreadyReturned.get(key) ?? 0)));
    }
    return remaining;
  }

  /** برای کلاینت: آیا چیزی برای این فاکتور باقی مانده که بتوان مرجوع کرد — تعیین می‌کند دکمه‌ی «ثبت مرجوعی» نمایش داده شود یا نه. */
  async returnable(ctx: TenantRequestContext, invoiceId: string): Promise<{ hasReturnable: boolean }> {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') return { hasReturnable: false };
    const remaining = await this.remainingByLine(ctx, invoiceId, invoice.lines);
    const hasReturnable = [...remaining.values()].some((qty) => qty > 0);
    return { hasReturnable };
  }

  async create(ctx: TenantRequestContext, dto: CreateSalesReturnDto) {
    const accounting = await isAccountingActive(this.controlDb, ctx.tenantId);
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
      throw new BadRequestException('فقط از فاکتورهای تأییدشده می‌توان مرجوعی ثبت کرد');
    }

    const remaining = await this.remainingByLine(ctx, dto.invoiceId, invoice.lines);
    for (const l of dto.lines) {
      const key = SalesReturnsService.keyOf(l);
      const max = remaining.get(key) ?? 0;
      if (l.quantity > max) {
        throw new BadRequestException(
          `مقدار مرجوعی برای «${l.description}» از مقدار خریداری‌شده در فاکتور بیشتر است (حداکثر قابل مرجوع: ${max})`,
        );
      }
    }

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice }));
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const userId = await resolveTenantUserId(ctx);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);

    // سند مرجوعی فقط وقتی حسابداری نصب است و سند خودِ فاکتور هم ثبت شده باشد؛ وگرنه (فاکتور قدیمی‌ای که هنوز
    // سندش ثبت نشده) مرجوعی همراه فاکتور در «ثبت اسناد حسابداری فاکتورهای قبلی» ثبت می‌شود تا درآمد منفی نشود.
    const postJournal = accounting && invoice.accountingPosted !== false;
    let journalLines: Awaited<ReturnType<typeof buildReturnJournalLines>> | null = null;
    if (postJournal) {
      await ensureDefaultChartOfAccounts(ctx.tenantDb);
      const linesWithCost = await Promise.all(
        lines.map(async (l) => {
          if (!l.productId) return { ...l, cost: 0 };
          const unitCost = await this.costing.currentUnitCost(ctx, l.productId);
          return { ...l, cost: unitCost * l.quantity };
        }),
      );
      const cogsAmount = linesWithCost.reduce((sum, l) => sum + l.cost, 0);
      journalLines = await buildReturnJournalLines(ctx.tenantDb, subtotal, cogsAmount).catch((e) => {
        if (e instanceof MissingAccountError) throw new BadRequestException(e.message);
        throw e;
      });
    }

    if (journalLines) await assertPeriodOpen(ctx.tenantDb, new Date());
    const results = await ctx.tenantDb.$transaction([
      ...(journalLines
        ? [
            ctx.tenantDb.journalEntry.create({
              data: {
                date: new Date(),
                description: `مرجوعی فروش برای فاکتور شماره ${invoice.invoiceNo}`,
                status: 'POSTED',
                postedAt: new Date(),
                createdByUserId: userId,
                lines: { create: journalLines },
              },
            }),
          ]
        : []),
      ctx.tenantDb.salesReturn.create({
        data: {
          invoiceId: dto.invoiceId,
          reason: dto.reason,
          notes: dto.notes,
          subtotal,
          total: subtotal,
          createdByUserId: userId,
          accountingPosted: journalLines !== null,
          lines: { create: lines },
        },
        include: RETURN_INCLUDE,
      }),
      ...dto.lines
        .filter((l) => l.productId)
        .map((l) =>
          ctx.tenantDb.stockMovement.create({
            data: {
              productId: l.productId!,
              warehouseId: warehouse.id,
              type: 'SALES_RETURN',
              quantityDelta: l.quantity,
              reference: `مرجوعی فروش برای فاکتور #${invoice.invoiceNo}`,
              createdByUserId: userId,
            },
          }),
        ),
    ]);
    const entry = journalLines ? (results[0] as { id: string }) : null;
    const ret = results[journalLines ? 1 : 0] as { id: string };

    if (entry) await ctx.tenantDb.salesReturn.update({ where: { id: ret.id }, data: { journalEntryId: entry.id } });
    return ret;
  }

  /**
   * حذف یک مرجوعی فروش. مرجوعی برخلاف فاکتور، وضعیت DRAFT ندارد — همان لحظه‌ی ثبت
   * سند حسابداری و حواله‌ی انبار واقعی پست شده، پس حذف ساده‌ی ردیف نادرست است. به‌جای
   * آن، دقیقاً از همان الگوی معکوس‌سازی که InvoicesService.cancelConfirmed برای ابطال
   * فاکتور تأییدشده استفاده می‌کند بهره می‌بریم: یک سند حسابداری معکوس برای سند اصلی
   * مرجوعی پست می‌شود (و سند اصلی voided می‌شود)، یک حواله‌ی انبار معکوس (ISSUE) برای
   * برگرداندن موجودی‌ای که مرجوعی اضافه کرده بود ثبت می‌شود، و در نهایت ردیف مرجوعی
   * (و خطوطش با onDelete: Cascade) حذف می‌شود — تا سقف قابل‌مرجوع فاکتور هم دوباره باز شود.
   */
  async remove(ctx: TenantRequestContext, id: string) {
    const ret = await ctx.tenantDb.salesReturn.findUnique({ where: { id }, include: { lines: true, invoice: true } });
    if (!ret) throw new NotFoundException('مرجوعی فروش یافت نشد');

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);
    const original = ret.journalEntryId
      ? await ctx.tenantDb.journalEntry.findUnique({ where: { id: ret.journalEntryId }, include: { lines: true } })
      : null;

    if (original) {
      await assertPeriodOpen(ctx.tenantDb, original.date);
      await assertPeriodOpen(ctx.tenantDb, new Date());
    }
    await ctx.tenantDb.$transaction([
      ...(original
        ? [
            ctx.tenantDb.journalEntry.create({
              data: {
                date: new Date(),
                description: `حذف مرجوعی فروش شماره ${ret.returnNo} برای فاکتور ${ret.invoice.invoiceNo}`,
                status: 'POSTED',
                postedAt: new Date(),
                reversalOfId: original.id,
                createdByUserId: userId ?? undefined,
                lines: { create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })) },
              },
            }),
            ctx.tenantDb.journalEntry.update({ where: { id: original.id }, data: { voidedAt: new Date(), voidReason: 'حذف مرجوعی فروش' } }),
          ]
        : []),
      ...ret.lines
        .filter((l) => l.productId)
        .map((l) =>
          ctx.tenantDb.stockMovement.create({
            data: {
              productId: l.productId!,
              warehouseId: warehouse.id,
              type: 'ISSUE',
              quantityDelta: -l.quantity,
              reference: `حذف مرجوعی فروش #${ret.returnNo}`,
              createdByUserId: userId ?? undefined,
            },
          }),
        ),
      ctx.tenantDb.salesReturn.delete({ where: { id } }),
    ]);
    return { success: true };
  }
}
