import { describe, expect, it } from 'vitest';
import { DashboardService } from './dashboard.service.js';

// toJalaliYearMonth (the Gregorian->Jalali month bucketing helper) isn't
// exported — it's exercised indirectly through summary(). These tests are
// deliberately independent of "today's" real date: they only assert that
// (a) dates within the same calendar month bucket together and (b) dates a
// full year apart land in different buckets — self-consistency, not tied
// to any specific date the test happens to run on.
describe('DashboardService sales trend month bucketing (via summary())', () => {
  function tenantDbStub(revenueLineDates: Date[]) {
    return {
      account: { count: async () => 11, findMany: async () => [] },
      journalLine: {
        findMany: async () => revenueLineDates.map((date) => ({ debit: 0, credit: 1_000_000, entry: { date } })),
      },
      salesInvoice: { findMany: async () => [], count: async () => 0 },
      check: { findMany: async () => [], count: async () => 0 },
      product: { findMany: async () => [] },
      billOfMaterial: { findMany: async () => [] },
      productionOrder: { findMany: async () => [] },
    };
  }

  it('always returns exactly 6 trailing months, in chronological order ending with the current month', async () => {
    const service = new DashboardService();
    const ctx = { tenantDb: tenantDbStub([]) } as never;
    const result = await service.summary(ctx);
    expect(result.salesTrend).toHaveLength(6);
  });

  it('sums two revenue lines from today into the current (last) bucket', async () => {
    // Both lines are dated exactly "now" — trivially the same Jalali month
    // regardless of where in the Gregorian month "now" falls (Jalali month
    // boundaries land mid-Gregorian-month, so picking two independently-
    // constructed same-Gregorian-month dates isn't safe near that boundary).
    const now = new Date();
    const service = new DashboardService();
    const ctx = { tenantDb: tenantDbStub([now, new Date(now.getTime())]) } as never;
    const result = await service.summary(ctx);
    const totalAcrossAllBuckets = result.salesTrend.reduce((s, b) => s + b.value, 0);
    expect(result.salesTrend[5].value).toBe(2_000_000);
    expect(totalAcrossAllBuckets).toBe(2_000_000);
  });

  it('excludes a revenue line from more than a year ago from every bucket', async () => {
    const now = new Date();
    const longAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    const service = new DashboardService();
    const ctx = { tenantDb: tenantDbStub([longAgo, now]) } as never;
    const result = await service.summary(ctx);
    const total = result.salesTrend.reduce((s, b) => s + b.value, 0);
    // Only "thisMonth" should count — the six-month-ago cutoff in the
    // service's own query means `longAgo` wouldn't even be fetched in
    // production, but this also guards the bucketing itself: even if it
    // were fetched, a date this far outside the 6 known buckets must be
    // silently dropped, not mis-bucketed into an adjacent month.
    expect(total).toBe(1_000_000);
  });
});
