import { describe, expect, it } from 'vitest';
import {
  RETAINED_PRIOR_ID,
  buildComparison,
  computeBalanceSheet,
  computeIncomeStatement,
  computeLedger,
  computeTrialBalance,
  incomeGroup,
  pctChange,
  toNum,
  type AccountLite,
  type SumMap,
} from './period-reports.js';

const accounts: AccountLite[] = [
  { id: 'cash', code: '1010', name: 'صندوق', type: 'ASSET' },
  { id: 'cap', code: '3010', name: 'سرمایه', type: 'EQUITY' },
  { id: 'rev', code: '4010', name: 'درآمد فروش', type: 'REVENUE' },
  { id: 'cogs', code: '5010', name: 'بهای تمام‌شده', type: 'EXPENSE' },
  { id: 'adm', code: '5020', name: 'هزینه اداری', type: 'EXPENSE' },
];
const m = (rows: Record<string, [number, number]>): SumMap => new Map(Object.entries(rows).map(([k, [d, c]]) => [k, { debit: BigInt(d), credit: BigInt(c) }]));

describe('income statement (period only)', () => {
  it('splits revenue, COGS, opex and computes gross/net', () => {
    const s = computeIncomeStatement(accounts, m({ rev: [0, 1000], cogs: [400, 0], adm: [150, 0] }));
    expect(s.totalRevenue).toBe(1000);
    expect(s.totalCogs).toBe(400);
    expect(s.totalOpex).toBe(150);
    expect(s.grossProfit).toBe(600);
    expect(s.netIncome).toBe(450);
    expect(s.totalExpense).toBe(550);
  });
  it('loss is negative', () => {
    expect(computeIncomeStatement(accounts, m({ rev: [0, 100], adm: [300, 0] })).netIncome).toBe(-200);
  });
  it('classifies groups by code', () => {
    expect(incomeGroup('EXPENSE', '5010')).toBe('COGS');
    expect(incomeGroup('EXPENSE', '5020')).toBe('OPEX');
    expect(incomeGroup('REVENUE', '4010')).toBe('REVENUE');
    expect(incomeGroup('ASSET', '1010')).toBeNull();
  });
});

describe('trial balance carry-forward', () => {
  // Mehr: cash +1000 funded by capital; Aban: sale 500 cash, expense 120 cash
  const mehr = m({ cash: [1000, 0], cap: [0, 1000] });
  const mehrPnl = m({ cash: [1000, 0], cap: [0, 1000], rev: [0, 300], adm: [100, 0] });
  void mehr;

  it('balance-sheet accounts carry forward; P&L accounts reset at fiscal-year start', () => {
    // all-time before Aban: cash 1000 -> mehrPnl above also has rev 300/adm 100 in Mehr (same fiscal year) and cash must tie out
    const before = m({ cash: [1000 + 200, 0], cap: [0, 1000], rev: [0, 300], adm: [100, 0] });
    const fiscalPre = m({ rev: [0, 300], adm: [100, 0] }); // same fiscal year => P&L opening = Mehr amounts
    const period = m({ cash: [500, 120], rev: [0, 500], adm: [120, 0] });
    const tb = computeTrialBalance(accounts, before, fiscalPre, period);
    const cash = tb.rows.find((r) => r.accountId === 'cash')!;
    expect(cash.openingDebit).toBe(1200);
    expect(cash.periodDebit).toBe(500);
    expect(cash.periodCredit).toBe(120);
    expect(cash.closingDebit).toBe(1580);
    const rev = tb.rows.find((r) => r.accountId === 'rev')!;
    expect(rev.openingCredit).toBe(300); // YTD carried within the fiscal year
    expect(rev.closingCredit).toBe(800);
    expect(tb.rows.find((r) => r.accountId === RETAINED_PRIOR_ID)).toBeUndefined();
    void mehrPnl;
  });

  it('previous fiscal year P&L moves to the synthetic retained-earnings row so the trial balance balances', () => {
    // before: last year revenue 900 (profit), expense 100; this fiscal year nothing yet. Cash holds the 800 profit + 1000 capital.
    const before = m({ cash: [1800, 0], cap: [0, 1000], rev: [0, 900], adm: [100, 0] });
    const fiscalPre = m({});
    const period = m({ cash: [50, 0], rev: [0, 50] });
    const tb = computeTrialBalance(accounts, before, fiscalPre, period);
    const prior = tb.rows.find((r) => r.accountId === RETAINED_PRIOR_ID)!;
    expect(prior.openingCredit).toBe(800);
    expect(tb.rows.find((r) => r.accountId === 'rev')!.openingCredit).toBe(0);
    expect(tb.totals.openingDebit).toBe(tb.totals.openingCredit);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.balanced).toBe(true);
  });

  it('cumulative (all) mode: opening is zero and turnover equals lifetime', () => {
    const period = m({ cash: [1000, 0], cap: [0, 1000] });
    const tb = computeTrialBalance(accounts, m({}), m({}), period);
    expect(tb.totals.openingDebit).toBe(0);
    expect(tb.totalDebit).toBe(1000);
    expect(tb.totalCredit).toBe(1000);
    expect(tb.rows.find((r) => r.accountId === 'rev')).toBeUndefined(); // inactive P&L rows hidden
  });
});

describe('balance sheet', () => {
  it('splits current-year and prior-years earnings and balances', () => {
    const all = m({ cash: [1800, 0], cap: [0, 1000], rev: [0, 900], adm: [100, 0] });
    const fy = m({ rev: [0, 300], adm: [50, 0] });
    const bs = computeBalanceSheet(accounts, all, fy);
    expect(bs.retainedEarnings).toBe(800);
    expect(bs.currentYearEarnings).toBe(250);
    expect(bs.priorYearsEarnings).toBe(550);
    expect(bs.totalAssets).toBe(1800);
    expect(bs.totalEquity).toBe(1800);
    expect(bs.balances).toBe(true);
  });
});

describe('ledger with opening row', () => {
  it('running balance starts from the carried opening (debit nature)', () => {
    const l = computeLedger('ASSET', 1000n, [
      { id: '1', entryNumber: 1, date: new Date(), description: null, debit: 200, credit: 0 },
      { id: '2', entryNumber: 2, date: new Date(), description: null, debit: 0, credit: 50 },
    ]);
    expect(l.opening).toBe(1000);
    expect(l.rows.map((r) => r.runningBalance)).toEqual([1200, 1150]);
    expect(l.closing).toBe(1150);
  });
  it('credit-nature accounts flip the sign', () => {
    const l = computeLedger('REVENUE', -300n, [{ id: '1', entryNumber: 1, date: new Date(), description: null, debit: 0, credit: 100 }]);
    expect(l.opening).toBe(300);
    expect(l.closing).toBe(400);
  });
});

describe('comparison deltas', () => {
  it('computes change amount and percent vs previous month; null pct when previous is zero', () => {
    const cmp = buildComparison(accounts, [
      { key: '1405-07', label: 'مهر', sums: m({ rev: [0, 1000], adm: [200, 0] }) },
      { key: '1405-08', label: 'آبان', sums: m({ rev: [0, 1500], adm: [200, 0], cogs: [300, 0] }) },
      { key: '1405-09', label: 'آذر', sums: m({}) },
    ]);
    expect(cmp.totals.revenue.values).toEqual([1000, 1500, 0]);
    expect(cmp.totals.revenue.changes[0]).toBeNull();
    expect(cmp.totals.revenue.changes[1]).toEqual({ amount: 500, pct: 50 });
    expect(cmp.totals.revenue.changes[2]).toEqual({ amount: -1500, pct: -100 });
    expect(cmp.totals.netIncome.values).toEqual([800, 1000, 0]);
    expect(cmp.totals.cogs.changes[1]).toEqual({ amount: 300, pct: null });
    const adm = cmp.accountRows.find((r) => r.accountId === 'adm')!;
    expect(adm.changes[1]).toEqual({ amount: 0, pct: 0 });
    expect(cmp.accountRows.some((r) => r.accountId === 'cash')).toBe(false);
  });
  it('pctChange rounds to one decimal', () => {
    expect(pctChange(1, 3)).toBe(-66.7);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe('integer safety', () => {
  it('refuses amounts beyond 2^53', () => {
    expect(() => toNum(BigInt(Number.MAX_SAFE_INTEGER) + 10n)).toThrow();
    expect(toNum(9_000_000_000_000n)).toBe(9_000_000_000_000);
  });
});
