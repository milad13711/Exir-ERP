import { describe, expect, it, vi } from 'vitest';
import { CreditScoreService } from './credit-score.service.js';
import type { PartyStatementService } from './party-statement.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

/**
 * A stub that reduces to exactly the old direct-invoice-sum formula (sum of
 * total - paidAmount across non-cancelled invoices) — mathematically
 * equivalent to the real PartyStatementService's arBalance for these
 * fixtures, since none of them include returns or PartyTransaction rows.
 */
function partyStatementStub(): PartyStatementService {
  return {
    statement: vi.fn(async (ctx: TenantRequestContext) => {
      const invoices = await ctx.tenantDb.salesInvoice.findMany();
      const arBalance = (invoices as Array<{ status: string; total: number; paidAmount?: number }>)
        .filter((i) => i.status !== 'CANCELLED')
        .reduce((sum, i) => sum + (i.total - (i.paidAmount ?? 0)), 0);
      return { lines: [], arBalance, apBalance: 0 };
    }),
  } as unknown as PartyStatementService;
}

function makeCtx(contact: Record<string, unknown>, invoices: Array<Record<string, unknown>>): TenantRequestContext {
  return {
    tenantDb: {
      crmContact: { findUniqueOrThrow: vi.fn().mockResolvedValue(contact) },
      salesInvoice: { findMany: vi.fn().mockResolvedValue(invoices) },
    },
  } as unknown as TenantRequestContext;
}

function baseContact(overrides: Record<string, unknown> = {}) {
  return { hasBouncedChecks: false, bankAvgMonthlyTurnover: null, creditLimitOverride: null, ...overrides };
}

describe('CreditScoreService — new customer (no invoice history)', () => {
  const service = new CreditScoreService(partyStatementStub());

  it('gives a neutral score of 50 and zero credit limit with no signals', async () => {
    const ctx = makeCtx(baseContact(), []);
    const result = await service.assess(ctx, 'c1');
    expect(result.basis).toBe('new');
    expect(result.score).toBe(50);
    expect(result.creditLimit).toBe(0);
  });

  it('penalizes a prior bounced check by 40 points', async () => {
    const ctx = makeCtx(baseContact({ hasBouncedChecks: true }), []);
    const result = await service.assess(ctx, 'c1');
    expect(result.score).toBe(10);
  });

  it('rewards bank turnover, capped at +30, and computes limit from it', async () => {
    const ctx = makeCtx(baseContact({ bankAvgMonthlyTurnover: 500_000_000 }), []);
    const result = await service.assess(ctx, 'c1');
    expect(result.score).toBe(80); // 50 + 30 (capped)
    expect(result.creditLimit).toBe(Math.round(500_000_000 * 0.3 * 0.8));
  });

  it('never lets bounced-check penalty push the score below 0', async () => {
    const ctx = makeCtx(baseContact({ hasBouncedChecks: true, bankAvgMonthlyTurnover: 0 }), []);
    const result = await service.assess(ctx, 'c1');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('a manual creditLimitOverride always wins over the computed limit', async () => {
    const ctx = makeCtx(baseContact({ bankAvgMonthlyTurnover: 500_000_000, creditLimitOverride: 999 }), []);
    const result = await service.assess(ctx, 'c1');
    expect(result.creditLimit).toBe(999);
  });
});

describe('CreditScoreService — customer with invoice history', () => {
  const service = new CreditScoreService(partyStatementStub());

  function paidInvoice(total: number, dueAt: string | null, paidAt: string) {
    return { status: 'PAID', total, dueAt: dueAt ? new Date(dueAt) : null, payments: [{ paidAt: new Date(paidAt) }] };
  }

  it('rewards perfect on-time payment history with a high score and a positive limit', async () => {
    const invoices = [
      paidInvoice(100_000_000, '2026-01-10', '2026-01-05'), // early
      paidInvoice(100_000_000, '2026-02-10', '2026-02-10'), // exactly on time
      paidInvoice(100_000_000, '2026-03-10', '2026-03-05'),
    ];
    const ctx = makeCtx(baseContact(), invoices);
    const result = await service.assess(ctx, 'c1');
    expect(result.basis).toBe('history');
    expect(result.score).toBeGreaterThan(50);
    expect(result.creditLimit).toBeGreaterThan(0);
  });

  it('penalizes a currently-overdue confirmed invoice', async () => {
    const overdueInvoice = {
      status: 'CONFIRMED',
      total: 50_000_000,
      dueAt: new Date('2020-01-01'), // long past
      payments: [],
    };
    const ctxWithOverdue = makeCtx(baseContact(), [overdueInvoice]);
    const ctxWithout = makeCtx(baseContact(), []);
    const withOverdue = await service.assess(ctxWithOverdue, 'c1');
    const withoutHistory = await service.assess(ctxWithout, 'c1');
    // An overdue invoice should score strictly worse than having no history at all.
    expect(withOverdue.score).toBeLessThan(withoutHistory.score);
  });

  it('a late payment (after dueAt) does not count as on-time', async () => {
    const late = paidInvoice(100_000_000, '2026-01-10', '2026-01-15');
    const ctx = makeCtx(baseContact(), [late]);
    const result = await service.assess(ctx, 'c1');
    expect(result.reasons.some((r) => r.includes('0٪ از'))).toBe(true);
  });

  it('totalOutstanding sums unpaid balances across non-cancelled invoices', async () => {
    const invoices = [
      { status: 'PARTIALLY_PAID', total: 100_000_000, paidAmount: 40_000_000, dueAt: null, payments: [] },
      { status: 'CANCELLED', total: 999_999_999, paidAmount: 0, dueAt: null, payments: [] },
    ];
    const ctx = makeCtx(baseContact(), invoices);
    const result = await service.assess(ctx, 'c1');
    expect(result.totalOutstanding).toBe(60_000_000);
  });

  it('still honors creditLimitOverride even with real history', async () => {
    const invoices = [paidInvoice(100_000_000, '2026-01-10', '2026-01-05')];
    const ctx = makeCtx(baseContact({ creditLimitOverride: 42 }), invoices);
    const result = await service.assess(ctx, 'c1');
    expect(result.creditLimit).toBe(42);
  });
});
