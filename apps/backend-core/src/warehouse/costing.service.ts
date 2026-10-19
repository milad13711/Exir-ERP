import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { currentStock } from './stock.js';

export type CostingMethod = 'LAST_COST' | 'WEIGHTED_AVERAGE' | 'FIFO';

const SETTINGS_MODULE = 'warehouse';
const SETTINGS_KEY = 'costingMethod';
const AUTO_SALE_PRICE_SETTINGS_KEY = 'autoSalePriceFromMargin';

type Layer = { qty: number; unitCost: number };

/**
 * بهای تمام‌شده‌ی کالا از روی تاریخچه‌ی «فعال» (بدون ردیف‌های ابطال‌شده/معکوس) — برای بازمحاسبه پس از ویرایش یا ابطال رسید.
 * LAST_COST/FIFO: بهای آخرین رسید دارای قیمت؛ WEIGHTED_AVERAGE: بازپخش میانگین موزون به ترتیب زمان.
 * null = رسید قیمت‌داری باقی نمانده، پس costPrice دست‌نخورده می‌ماند.
 */
export function replayCostPrice(
  method: CostingMethod,
  movements: Array<{ quantityDelta: number; unitCost: number | null; createdAt: Date }>,
): number | null {
  const sorted = [...movements].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const priced = sorted.filter((m) => m.quantityDelta > 0 && m.unitCost != null && m.unitCost > 0);
  if (priced.length === 0) return null;
  if (method !== 'WEIGHTED_AVERAGE') return priced[priced.length - 1].unitCost!;
  let stock = 0;
  let avg = 0;
  for (const m of sorted) {
    if (m.quantityDelta > 0 && m.unitCost != null && m.unitCost > 0) {
      avg = stock <= 0 ? m.unitCost : Math.round((stock * avg + m.quantityDelta * m.unitCost) / (stock + m.quantityDelta));
    }
    stock += m.quantityDelta;
  }
  return avg;
}

/** salePrice = costPrice * (1 + profitMarginPercent/100), rounded like every other money math in this codebase. */
export function computeSalePriceFromMargin(costPrice: number, profitMarginPercent: number): number {
  return Math.round(costPrice * (1 + profitMarginPercent / 100));
}

type TenantTx = Parameters<Parameters<TenantRequestContext['tenantDb']['$transaction']>[0]>[0];

/**
 * بهای تمام‌شده (و در صورت فعال‌بودن، قیمت فروش خودکار) را از روی تاریخچه‌ی «فعال» (بدون ردیف‌های ابطال‌شده/معکوس)
 * بازمحاسبه می‌کند — پس از ویرایش یا ابطال رسید. اگر رسید قیمت‌دار فعالی نمانده باشد costPrice دست‌نخورده می‌ماند.
 */
export async function refreshProductCost(tx: TenantTx, productId: string, method: CostingMethod, autoSale: boolean): Promise<void> {
  const rows = await tx.stockMovement.findMany({
    where: { productId, voidedAt: null, reversalOfId: null },
    select: { quantityDelta: true, unitCost: true, createdAt: true },
  });
  const cost = replayCostPrice(method, rows);
  if (cost == null) return;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { costPrice: true, profitMarginPercent: true, salePriceSource: true } });
  if (!product || product.costPrice === cost) return;
  const salePrice =
    autoSale && product.profitMarginPercent && product.salePriceSource !== 'MANUAL'
      ? computeSalePriceFromMargin(cost, Number(product.profitMarginPercent))
      : null;
  await tx.product.update({
    where: { id: productId },
    data: { costPrice: cost, ...(salePrice != null ? { salePrice, salePriceUpdatedAt: new Date() } : {}) },
  });
}

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
   * تنظیم سراسری «محاسبه خودکار قیمت فروش از درصد سود» (تنظیمات فروش) —
   * پیش‌فرض فعال است. وقتی غیرفعال باشد، درصد سود همچنان در ورود اکسل/ویرایش
   * کالا ذخیره می‌شود ولی هیچ‌جا (نه اکسل، نه ویرایش دستی، نه رسید انبار) از
   * روی آن قیمت فروش بازمحاسبه نمی‌شود.
   */
  async getAutoSalePriceEnabled(ctx: TenantRequestContext): Promise<boolean> {
    const setting = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: SETTINGS_MODULE, key: AUTO_SALE_PRICE_SETTINGS_KEY } },
    });
    return setting?.value !== false;
  }

  async setAutoSalePriceEnabled(ctx: TenantRequestContext, enabled: boolean) {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SETTINGS_MODULE, key: AUTO_SALE_PRICE_SETTINGS_KEY } },
      create: { moduleCode: SETTINGS_MODULE, key: AUTO_SALE_PRICE_SETTINGS_KEY, value: enabled },
      update: { value: enabled },
    });
  }

  /**
   * قیمت فروش جدیدی که باید روی Product.salePrice نشسته شود وقتی
   * costPrice این کالا از یک رسید واقعی (نه ویرایش دستی) به `newCostPrice`
   * تغییر کرد — یا null اگر نباید دست بخورد (تنظیم سراسری غیرفعال است، این
   * کالا درصد سود ندارد، یا salePriceSource آن روی MANUAL است چون فروشنده
   * قبلاً قیمت فروش را مستقیماً ویرایش کرده).
   */
  async nextSalePriceOnReceipt(
    ctx: TenantRequestContext,
    productId: string,
    newCostPrice: number,
  ): Promise<number | null> {
    const enabled = await this.getAutoSalePriceEnabled(ctx);
    if (!enabled) return null;
    const product = await ctx.tenantDb.product.findUnique({
      where: { id: productId },
      select: { profitMarginPercent: true, salePriceSource: true },
    });
    if (!product?.profitMarginPercent || product.salePriceSource === 'MANUAL') return null;
    return computeSalePriceFromMargin(newCostPrice, Number(product.profitMarginPercent));
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
    // رسید/حواله‌ی ابطال‌شده و ردیف معکوسش هر دو کنار گذاشته می‌شوند (انگار هرگز ثبت نشده‌اند)، وگرنه معکوس‌شدنِ یک
    // رسید لایه‌ی نادرستی از صف FIFO مصرف می‌کرد.
    const movements = await ctx.tenantDb.stockMovement.findMany({
      where: { productId, voidedAt: null, reversalOfId: null },
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
