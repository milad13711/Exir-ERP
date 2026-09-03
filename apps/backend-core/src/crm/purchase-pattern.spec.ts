import { describe, expect, it } from 'vitest';
import { computeCustomerFollowUps, type PurchaseLine } from './purchase-pattern.js';

function line(contactId: string, productId: string, daysAgo: number, now: Date): PurchaseLine {
  return {
    contactId,
    contactName: `مشتری ${contactId}`,
    productId,
    productName: `محصول ${productId}`,
    issuedAt: new Date(now.getTime() - daysAgo * 86_400_000),
  };
}

describe('computeCustomerFollowUps', () => {
  const now = new Date('2026-09-03T00:00:00Z');

  it('flags a customer overdue relative to their own ~30-day rhythm', () => {
    // Purchased every 30 days (-95, -65, -35), then nothing since — 5 days past their own rhythm.
    const lines = [line('c1', 'p1', 95, now), line('c1', 'p1', 65, now), line('c1', 'p1', 35, now)];
    const result = computeCustomerFollowUps(lines, now);
    expect(result).toHaveLength(1);
    expect(result[0].avgIntervalDays).toBe(30);
    expect(result[0].daysOverdue).toBeGreaterThan(0);
  });

  it('does not flag a customer who purchased within their usual interval', () => {
    const lines = [line('c1', 'p1', 90, now), line('c1', 'p1', 60, now), line('c1', 'p1', 20, now)];
    expect(computeCustomerFollowUps(lines, now)).toHaveLength(0);
  });

  it('ignores a pair with only one purchase — no rhythm to compare against', () => {
    const lines = [line('c1', 'p1', 90, now)];
    expect(computeCustomerFollowUps(lines, now)).toHaveLength(0);
  });

  it('sorts the most overdue candidate first', () => {
    const lines = [
      // c1/p1: 30-day rhythm, 10 days overdue
      line('c1', 'p1', 70, now),
      line('c1', 'p1', 40, now),
      // c2/p2: 10-day rhythm, 40 days overdue — much further past due
      line('c2', 'p2', 60, now),
      line('c2', 'p2', 50, now),
    ];
    const result = computeCustomerFollowUps(lines, now);
    expect(result[0].contactId).toBe('c2');
  });
});
