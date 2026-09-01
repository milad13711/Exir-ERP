import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { currentStock } from './stock.js';

export type CostingMethod = 'LAST_COST' | 'WEIGHTED_AVERAGE' | 'FIFO';

const SETTINGS_MODULE = 'warehouse';
const SETTINGS_KEY = 'costingMethod';

type Layer = { qty: number; unitCost: number };

/**
 * سه روش بهای تمام‌شده‌ی موجودی: آخرین قیمت خرید (پیش‌فرض، رفتار قبلی سیستم
 * بدون تغییر)، میانگین موزون (Product.costPrice در لحظه‌ی هر رسید بازمحاسبه
 * می‌شود)، و FIFO (بهای هر خروج با پیمایش تاریخچه‌ی StockMovement و مصرف
 * لایه‌های رسید به ترتیب ورود محاسبه می‌شود — بدون نیاز به جدول لایه‌ی جدید).
 */
@Injectable()
export class CostingService {
  async getMethod(ctx: TenantRequestContext): Promise<CostingMethod> {
    const setting = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: SETTINGS_MODULE, key: SETTINGS_KEY } },
    });
    const value = setting?.value as CostingMethod | undefined;
    return value === 'WEIGHTED_AVERAGE' || value === 'FIFO' ? value : 'LAST_COST';
  }

  async setMethod(ctx: TenantRequestContext, method: CostingMethod) {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SETTINGS_MODULE, key: SETTINGS_KEY } },
      create: { moduleCode: SETTINGS_MODULE, key: SETTINGS_KEY, value: method },
      update: { value: method },
    });
  }

  /**
   * بهای تمام‌شده‌ی جدیدی که باید روی Product.costPrice نشسته شود وقتی
   * `receivedQty` واحد به بهای `receivedUnitCost` وارد می‌شود. با روش
   * آخرین‌قیمت یا FIFO فقط همان قیمت رسید اخیر است (برای FIFO این فیلد صرفاً
   * نمایشی است — محاسبه‌ی واقعی COGS از پیمایش تاریخچه می‌آید)؛ با میانگین
   * موزون، میانگین وزن‌دار موجودی قبلی و رسید تازه محاسبه می‌شود.
   */
  async nextCostPriceOnReceipt(
    ctx: TenantRequestContext,
    productId: string,
    receivedQty: number,
    receivedUnitCost: number,
  ): Promise<number> {
    const method = await this.getMethod(ctx);
    if (method !== 'WEIGHTED_AVERAGE') return receivedUnitCost;
    const product = await ctx.tenantDb.product.findUnique({
      where: { id: productId },
      include: { movements: { select: { quantityDelta: true } } },
    });
    const stockBefore = currentStock(product?.movements ?? []);
    if (stockBefore <= 0) return receivedUnitCost;
    const oldCost = product?.costPrice ?? 0;
    return Math.round((stockBefore * oldCost + receivedQty * receivedUnitCost) / (stockBefore + receivedQty));
  }

  /** جمع بهای تمام‌شده برای خروج `quantity` واحد از این کالا، همین الان. */
  async costIssue(ctx: TenantRequestContext, productId: string, quantity: number): Promise<number> {
    const method = await this.getMethod(ctx);
    if (method !== 'FIFO') {
      const product = await ctx.tenantDb.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
      return (product?.costPrice ?? 0) * quantity;
    }
    const layers = await this.fifoLayers(ctx, productId);
    let remaining = quantity;
    let total = 0;
    for (const layer of layers) {
      if (remaining <= 0) break;
      const consumed = Math.min(layer.qty, remaining);
      total += consumed * layer.unitCost;
      remaining -= consumed;
    }
    if (remaining > 0) {
      // موجودی ثبت‌شده‌ی قدیمی‌تر از این ویژگی که لایه‌ای برایش نداریم — با آخرین بهای شناخته‌شده جبران می‌شود.
      const product = await ctx.tenantDb.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
      total += remaining * (product?.costPrice ?? 0);
    }
    return Math.round(total);
  }

  /** بهای واحد فعلی این کالا برای مصارف نمایشی/برگشتی (مثل مرجوعی فروش). */
  async currentUnitCost(ctx: TenantRequestContext, productId: string): Promise<number> {
    const method = await this.getMethod(ctx);
    const product = await ctx.tenantDb.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
    if (method !== 'FIFO') return product?.costPrice ?? 0;
    const layers = await this.fifoLayers(ctx, productId);
    return layers[0]?.unitCost ?? product?.costPrice ?? 0;
  }

  private async fifoLayers(ctx: TenantRequestContext, productId: string): Promise<Layer[]> {
    const movements = await ctx.tenantDb.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
      select: { quantityDelta: true, unitCost: true },
    });
    const layers: Layer[] = [];
    let lastCost = 0;
    for (const m of movements) {
      if (m.quantityDelta > 0) {
        const cost = m.unitCost ?? lastCost;
        lastCost = cost;
        layers.push({ qty: m.quantityDelta, unitCost: cost });
      } else if (m.quantityDelta < 0) {
        let remaining = -m.quantityDelta;
        while (remaining > 0 && layers.length > 0) {
          const layer = layers[0];
          const consumed = Math.min(layer.qty, remaining);
          layer.qty -= consumed;
          remaining -= consumed;
          if (layer.qty === 0) layers.shift();
        }
      }
    }
    return layers;
  }
}
