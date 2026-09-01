/**
 * برای کالای قیمت‌گذاری‌شده به ارز خارجی، معادل تومانی‌اش را با نرخ *لحظه‌ای*
 * ارز محاسبه می‌کند — نه با costPrice/salePrice ذخیره‌شده — تا با تغییر نرخ،
 * نمایش کاتالوگ همیشه به‌روز بماند. کالای تومانی خالص بدون تغییر برمی‌گردد.
 */
export function withFxPrices<
  T extends {
    currencyId: string | null;
    costPrice: number;
    salePrice: number;
    costPriceFx: unknown;
    salePriceFx: unknown;
    currency?: { rate: unknown } | null;
  },
>(product: T): T {
  if (!product.currencyId || !product.currency) return product;
  const rate = Number(product.currency.rate);
  return {
    ...product,
    costPrice: product.costPriceFx != null ? Math.round(Number(product.costPriceFx) * rate) : product.costPrice,
    salePrice: product.salePriceFx != null ? Math.round(Number(product.salePriceFx) * rate) : product.salePrice,
  };
}
