import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import type { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto.js';

const ACCOUNT = {
  PAYABLE: '2010',
  INVENTORY: '1040',
};

const RETURN_INCLUDE = {
  order: { select: { id: true, orderNo: true, supplierId: true } },
  lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

@Injectable()
export class PurchaseReturnsService {
  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.purchaseReturn.findMany({
      include: {
        order: { select: { id: true, orderNo: true, supplier: { select: { id: true, name: true, company: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const ret = await ctx.tenantDb.purchaseReturn.findUnique({ where: { id }, include: RETURN_INCLUDE });
    if (!ret) throw new NotFoundException('مرجوعی خرید یافت نشد');
    return ret;
  }

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }

  async create(ctx: TenantRequestContext, dto: CreatePurchaseReturnDto) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const order = await ctx.tenantDb.purchaseOrder.findUnique({
      where: { id: dto.orderId },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('سفارش خرید یافت نشد');
    if (order.status === 'DRAFT' || order.status === 'CANCELLED') {
      throw new BadRequestException('فقط از سفارش‌های دریافت‌شده می‌توان مرجوعی ثبت کرد');
    }

    // مثل مرجوعی فروش: ردیف‌های دارای کالا با شناسه‌شان کلید می‌شوند، ردیف‌های
    // آزاد (بدون کالا) با شرح‌شان — تنها کلید پایدار موجود برای آن‌ها.
    const priorReturns = await ctx.tenantDb.purchaseReturnLine.findMany({
      where: { return: { orderId: dto.orderId } },
    });
    const keyOf = (l: { productId?: string | null; description: string }) => l.productId ?? `desc:${l.description}`;
    const alreadyReturned = new Map<string, number>();
    for (const l of priorReturns) {
      const key = keyOf(l);
      alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + l.quantity);
    }
    const orderedQty = new Map<string, number>();
    for (const l of order.lines) {
      const key = keyOf(l);
      orderedQty.set(key, (orderedQty.get(key) ?? 0) + l.quantity);
    }
    for (const l of dto.lines) {
      const key = keyOf(l);
      const max = orderedQty.get(key) ?? 0;
      const already = alreadyReturned.get(key) ?? 0;
      if (already + l.quantity > max) {
        throw new BadRequestException(
          `مقدار مرجوعی برای «${l.description}» از مقدار خریداری‌شده در سفارش بیشتر است (حداکثر قابل مرجوع: ${Math.max(0, max - already)})`,
        );
      }
    }

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitCost }));
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const userId = await resolveTenantUserId(ctx);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);

    const payable = await this.getAccount(ctx, ACCOUNT.PAYABLE);
    const inventory = await this.getAccount(ctx, ACCOUNT.INVENTORY);

    const [entry, ret] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `مرجوعی خرید برای سفارش شماره ${order.orderNo}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: payable.id, debit: BigInt(subtotal), credit: BigInt(0) },
              { accountId: inventory.id, debit: BigInt(0), credit: BigInt(subtotal) },
            ],
          },
        },
      }),
      ctx.tenantDb.purchaseReturn.create({
        data: {
          orderId: dto.orderId,
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
              type: 'PURCHASE_RETURN',
              quantityDelta: -l.quantity,
              reference: `مرجوعی خرید برای سفارش #${order.orderNo}`,
              createdByUserId: userId,
            },
          }),
        ),
    ]);

    await ctx.tenantDb.purchaseReturn.update({ where: { id: ret.id }, data: { journalEntryId: entry.id } });
    return ret;
  }

  /**
   * حذف یک مرجوعی خرید. مرجوعی مثل سند ثبت‌شده‌ی مرجوعی فروش (نگاه کنید به
   * SalesReturnsService.remove) وضعیت DRAFT ندارد — همان لحظه‌ی ثبت سند
   * حسابداری و حواله‌ی انبار واقعی پست شده، پس حذف ساده‌ی ردیف نادرست است.
   * به‌جای آن: یک سند حسابداری معکوس برای سند اصلی پست می‌شود (و سند اصلی
   * voided می‌شود)، یک حواله‌ی انبار معکوس (RECEIPT) برای برگرداندن موجودی‌ای
   * که مرجوعی کم کرده بود ثبت می‌شود، و در نهایت ردیف مرجوعی (و خطوطش با
   * onDelete: Cascade) حذف می‌شود — تا سقف قابل‌مرجوع سفارش هم دوباره باز شود.
   */
  async remove(ctx: TenantRequestContext, id: string) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const ret = await ctx.tenantDb.purchaseReturn.findUnique({ where: { id }, include: { lines: true, order: true } });
    if (!ret) throw new NotFoundException('مرجوعی خرید یافت نشد');

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);
    const original = ret.journalEntryId
      ? await ctx.tenantDb.journalEntry.findUnique({ where: { id: ret.journalEntryId }, include: { lines: true } })
      : null;

    await ctx.tenantDb.$transaction([
      ...(original
        ? [
            ctx.tenantDb.journalEntry.create({
              data: {
                date: new Date(),
                description: `حذف مرجوعی خرید شماره ${ret.returnNo} برای سفارش ${ret.order.orderNo}`,
                status: 'POSTED',
                postedAt: new Date(),
                reversalOfId: original.id,
                createdByUserId: userId ?? undefined,
                lines: { create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })) },
              },
            }),
            ctx.tenantDb.journalEntry.update({ where: { id: original.id }, data: { voidedAt: new Date(), voidReason: 'حذف مرجوعی خرید' } }),
          ]
        : []),
      ...ret.lines
        .filter((l) => l.productId)
        .map((l) =>
          ctx.tenantDb.stockMovement.create({
            data: {
              productId: l.productId!,
              warehouseId: warehouse.id,
              type: 'RECEIPT',
              quantityDelta: l.quantity,
              unitCost: l.unitCost,
              reference: `حذف مرجوعی خرید #${ret.returnNo}`,
              createdByUserId: userId ?? undefined,
            },
          }),
        ),
      ctx.tenantDb.purchaseReturn.delete({ where: { id } }),
    ]);
    return { success: true };
  }
}
