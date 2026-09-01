import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { CostingService } from '../warehouse/costing.service.js';
import type { CreateSalesReturnDto } from './dto/create-sales-return.dto.js';

const ACCOUNT = {
  RECEIVABLE: '1030',
  INVENTORY: '1040',
  REVENUE: '4010',
  COGS: '5010',
};

const RETURN_INCLUDE = {
  invoice: { select: { id: true, invoiceNo: true, contactId: true } },
  lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

@Injectable()
export class SalesReturnsService {
  constructor(private readonly costing: CostingService) {}

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

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }

  async create(ctx: TenantRequestContext, dto: CreateSalesReturnDto) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
      throw new BadRequestException('فقط از فاکتورهای تأییدشده می‌توان مرجوعی ثبت کرد');
    }

    // سقف مرجوعی هر ردیف: مقدار آن در فاکتور، منهای مقدار قبلاً مرجوع‌شده‌اش —
    // مجموع مرجوعی‌های یک ردیف هرگز نباید از مقدار خریداری‌شده‌اش بیشتر شود.
    // کالاهای دارای productId با شناسه‌شان کلید می‌شوند؛ ردیف‌های آزاد بدون
    // کالا (مثلاً خدمات) با شرح‌شان — تنها کلید پایدار موجود برای آن‌ها.
    const priorReturns = await ctx.tenantDb.salesReturnLine.findMany({
      where: { return: { invoiceId: dto.invoiceId } },
    });
    const keyOf = (l: { productId?: string | null; description: string }) => l.productId ?? `desc:${l.description}`;
    const alreadyReturned = new Map<string, number>();
    for (const l of priorReturns) {
      const key = keyOf(l);
      alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + l.quantity);
    }
    const invoicedQty = new Map<string, number>();
    for (const l of invoice.lines) {
      const key = keyOf(l);
      invoicedQty.set(key, (invoicedQty.get(key) ?? 0) + l.quantity);
    }
    for (const l of dto.lines) {
      const key = keyOf(l);
      const max = invoicedQty.get(key) ?? 0;
      const already = alreadyReturned.get(key) ?? 0;
      if (already + l.quantity > max) {
        throw new BadRequestException(
          `مقدار مرجوعی برای «${l.description}» از مقدار خریداری‌شده در فاکتور بیشتر است (حداکثر قابل مرجوع: ${Math.max(0, max - already)})`,
        );
      }
    }

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice }));
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const userId = await resolveTenantUserId(ctx);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);

    const receivable = await this.getAccount(ctx, ACCOUNT.RECEIVABLE);
    const revenue = await this.getAccount(ctx, ACCOUNT.REVENUE);
    const linesWithCost = await Promise.all(
      lines.map(async (l) => {
        if (!l.productId) return { ...l, cost: 0 };
        const unitCost = await this.costing.currentUnitCost(ctx, l.productId);
        return { ...l, cost: unitCost * l.quantity };
      }),
    );
    const cogsAmount = linesWithCost.reduce((sum, l) => sum + l.cost, 0);

    const journalLines = [
      { accountId: revenue.id, debit: BigInt(subtotal), credit: BigInt(0) },
      { accountId: receivable.id, debit: BigInt(0), credit: BigInt(subtotal) },
    ];
    if (cogsAmount > 0) {
      const cogs = await this.getAccount(ctx, ACCOUNT.COGS);
      const inventory = await this.getAccount(ctx, ACCOUNT.INVENTORY);
      journalLines.push(
        { accountId: inventory.id, debit: BigInt(cogsAmount), credit: BigInt(0) },
        { accountId: cogs.id, debit: BigInt(0), credit: BigInt(cogsAmount) },
      );
    }

    const [entry, ret] = await ctx.tenantDb.$transaction([
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
      ctx.tenantDb.salesReturn.create({
        data: {
          invoiceId: dto.invoiceId,
          reason: dto.reason,
          notes: dto.notes,
          subtotal,
          total: subtotal,
          createdByUserId: userId,
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

    await ctx.tenantDb.salesReturn.update({ where: { id: ret.id }, data: { journalEntryId: entry.id } });
    return ret;
  }
}
