/**
 * Detects a product whose production has, historically, been notably
 * higher in one specific Jalali month than in its other months — the
 * "هر سال شهریور تولید فلان محصول زیاد می‌شه" pattern. Deliberately a plain
 * statistical rule (compare this month's average to the average of every
 * OTHER month for the same product), not a forecasting model — good enough
 * to justify a heads-up, not precise enough to pretend it's a prediction.
 */
export type ProductionHistoryEntry = {
  productId: string;
  productName: string;
  jalaliYear: number;
  jalaliMonth: number; // 1-12
  quantityProduced: number;
};

export type SeasonalSpike = {
  productId: string;
  productName: string;
  targetMonth: number;
  avgQuantityInMonth: number;
  avgQuantityOtherMonths: number;
  spikeRatio: number;
  yearsOfData: number;
};

const SPIKE_RATIO_THRESHOLD = 1.4; // month's average must be at least 40% above the product's other months
const MIN_YEARS_OF_DATA = 2; // one high month, one year, could just be a fluke — need it to repeat

export function detectSeasonalSpikes(history: ProductionHistoryEntry[], targetMonth: number): SeasonalSpike[] {
  const byProduct = new Map<string, ProductionHistoryEntry[]>();
  for (const h of history) {
    const list = byProduct.get(h.productId) ?? [];
    list.push(h);
    byProduct.set(h.productId, list);
  }

  const results: SeasonalSpike[] = [];
  for (const entries of byProduct.values()) {
    const monthEntries = entries.filter((e) => e.jalaliMonth === targetMonth);
    const yearsOfData = new Set(monthEntries.map((e) => e.jalaliYear)).size;
    if (yearsOfData < MIN_YEARS_OF_DATA) continue;

    const otherEntries = entries.filter((e) => e.jalaliMonth !== targetMonth);
    if (otherEntries.length === 0) continue;

    const avgQuantityInMonth = monthEntries.reduce((s, e) => s + e.quantityProduced, 0) / monthEntries.length;
    const avgQuantityOtherMonths = otherEntries.reduce((s, e) => s + e.quantityProduced, 0) / otherEntries.length;
    if (avgQuantityOtherMonths <= 0) continue;

    const spikeRatio = avgQuantityInMonth / avgQuantityOtherMonths;
    if (spikeRatio < SPIKE_RATIO_THRESHOLD) continue;

    results.push({
      productId: monthEntries[0].productId,
      productName: monthEntries[0].productName,
      targetMonth,
      avgQuantityInMonth: Math.round(avgQuantityInMonth),
      avgQuantityOtherMonths: Math.round(avgQuantityOtherMonths),
      spikeRatio: Math.round(spikeRatio * 100) / 100,
      yearsOfData,
    });
  }

  return results.sort((a, b) => b.spikeRatio - a.spikeRatio);
}
