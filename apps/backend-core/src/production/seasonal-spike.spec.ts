import { describe, expect, it } from 'vitest';
import { detectSeasonalSpikes, type ProductionHistoryEntry } from './seasonal-spike.js';

function entry(year: number, month: number, qty: number): ProductionHistoryEntry {
  return { productId: 'p1', productName: 'کنسانتره تست', jalaliYear: year, jalaliMonth: month, quantityProduced: qty };
}

describe('detectSeasonalSpikes', () => {
  it('flags a month that is consistently much higher across 2+ years', () => {
    const history: ProductionHistoryEntry[] = [
      entry(1403, 6, 2000), // شهریور — spike, year 1403
      entry(1403, 3, 500),
      entry(1403, 9, 500),
      entry(1404, 6, 2100), // شهریور — spike again, year 1404
      entry(1404, 3, 520),
      entry(1404, 9, 480),
    ];
    const result = detectSeasonalSpikes(history, 6);
    expect(result).toHaveLength(1);
    expect(result[0].yearsOfData).toBe(2);
    expect(result[0].spikeRatio).toBeGreaterThan(1.4);
  });

  it('does not flag a month with only one year of data, even if unusually high', () => {
    const history: ProductionHistoryEntry[] = [entry(1404, 6, 5000), entry(1404, 3, 500), entry(1404, 9, 500)];
    expect(detectSeasonalSpikes(history, 6)).toHaveLength(0);
  });

  it('does not flag a month that is only mildly above average', () => {
    const history: ProductionHistoryEntry[] = [
      entry(1403, 6, 600),
      entry(1403, 3, 500),
      entry(1404, 6, 620),
      entry(1404, 3, 520),
    ];
    expect(detectSeasonalSpikes(history, 6)).toHaveLength(0);
  });

  it('only evaluates the requested target month, ignoring other months even if they also spike', () => {
    const history: ProductionHistoryEntry[] = [
      entry(1403, 6, 2000),
      entry(1403, 1, 2000),
      entry(1403, 3, 500),
      entry(1404, 6, 2100),
      entry(1404, 1, 2100),
      entry(1404, 3, 520),
    ];
    const result = detectSeasonalSpikes(history, 6);
    expect(result.every((r) => r.targetMonth === 6)).toBe(true);
  });
});
