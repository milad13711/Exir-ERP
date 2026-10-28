import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

/**
 * محاسبات گزارش‌های دوره‌ای. همه‌ی جمع‌ها با BigInt جمع می‌شوند (مبالغ دفتر BigInt هستند) و فقط در مرز خروجی به
 * Number تبدیل می‌شوند؛ تبدیل ناامن (> 2^53) خطا می‌دهد، نه گرد کردن بی‌صدا.
 *
 * قواعد:
 *  - ترازنامه‌ای‌ها (دارایی/بدهی/حقوق صاحبان سهام): مانده‌ی ابتدای دوره = جمع تجمعیِ تمام اسناد پیش از `from`.
 *  - درآمد/هزینه: مانده‌ی ابتدای دوره = جمع از ابتدای «سال مالی» تا پیش از `from` (در اولین ماه سال مالی صفر).
 *    سود/زیان سال‌های قبل در ردیف مصنوعی «سود و زیان انباشته سال‌های قبل» می‌آید تا تراز همیشه متوازن بماند.
 */

export type Sum = { debit: bigint; credit: bigint };
export type SumMap = Map<string, Sum>;
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type AccountLite = { id: string; code: string; name: string; type: AccountType; isCashAccount?: boolean };

export const RETAINED_PRIOR_ID = '__retained_prior__';
const ZERO: Sum = { debit: 0n, credit: 0n };

export function toNum(b: bigint): number {
  if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('مبلغ بیش از حد مجاز محاسبه');
  return Number(b);
}

const isDebitNature = (t: AccountType) => t === 'ASSET' || t === 'EXPENSE';
const isPnl = (t: AccountType) => t === 'REVENUE' || t === 'EXPENSE';

/** مانده‌ی طبیعی (سمت عادی حساب مثبت) از خالص بدهکار−بستانکار. */
export function natural(type: AccountType, net: bigint): number {
  return toNum(isDebitNature(type) ? net : -net);
}

export type IncomeGroup = 'REVENUE' | 'COGS' | 'OPEX';
/** بهای تمام‌شده = حساب‌های هزینه با کد ۵۰۱x (۵۰۱۰ پیش‌فرض)؛ سایر هزینه‌ها = هزینه‌های عملیاتی/اداری. */
export function incomeGroup(type: AccountType, code: string): IncomeGroup | null {
  if (type === 'REVENUE') return 'REVENUE';
  if (type === 'EXPENSE') return code.startsWith('501') ? 'COGS' : 'OPEX';
  return null;
}

export function sumFor(map: SumMap, id: string): Sum {
  return map.get(id) ?? ZERO;
}

export async function loadSums(
  db: Pick<TenantPrismaClient, 'journalLine'>,
  range: { gte?: Date; lt?: Date },
): Promise<SumMap> {
  const date: { gte?: Date; lt?: Date } = {};
  if (range.gte) date.gte = range.gte;
  if (range.lt) date.lt = range.lt;
  const rows = await db.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: { status: 'POSTED', date } },
    _sum: { debit: true, credit: true },
  });
  const map: SumMap = new Map();
  for (const r of rows) map.set(r.accountId, { debit: r._sum.debit ?? 0n, credit: r._sum.credit ?? 0n });
  return map;
}

// ── سود و زیان ──────────────────────────────────────────────────────────────

export type PnlRow = { accountId: string; code: string; name: string; amount: number; group: IncomeGroup };

export function computeIncomeStatement(accounts: AccountLite[], sums: SumMap) {
  const rows: PnlRow[] = [];
  for (const a of accounts) {
    const group = incomeGroup(a.type, a.code);
    if (!group) continue;
    const s = sumFor(sums, a.id);
    rows.push({ accountId: a.id, code: a.code, name: a.name, amount: natural(a.type, s.debit - s.credit), group });
  }
  const sum = (g: IncomeGroup) => rows.filter((r) => r.group === g).reduce((x, r) => x + r.amount, 0);
  const totalRevenue = sum('REVENUE');
  const totalCogs = sum('COGS');
  const totalOpex = sum('OPEX');
  const grossProfit = totalRevenue - totalCogs;
  return {
    revenueRows: rows.filter((r) => r.group === 'REVENUE'),
    cogsRows: rows.filter((r) => r.group === 'COGS'),
    opexRows: rows.filter((r) => r.group === 'OPEX'),
    expenseRows: rows.filter((r) => r.group !== 'REVENUE'),
    totalRevenue,
    totalCogs,
    totalOpex,
    totalExpense: totalCogs + totalOpex,
    grossProfit,
    netIncome: grossProfit - totalOpex,
  };
}

// ── تراز آزمایشی دوره‌ای ────────────────────────────────────────────────────

export type TrialRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
  /** مانده‌ی طبیعی پایان دوره (سمت عادی مثبت) — برای سازگاری با نسخه‌ی قبلی API */
  balance: number;
  openingBalance: number;
  /** سازگاری عقب‌رو: = periodDebit / periodCredit */
  debit: number;
  credit: number;
};

function splitNet(net: bigint): { debit: number; credit: number } {
  return net >= 0n ? { debit: toNum(net), credit: 0 } : { debit: 0, credit: toNum(-net) };
}

export function computeTrialBalance(accounts: AccountLite[], allBefore: SumMap, fiscalPre: SumMap, period: SumMap) {
  const rows: TrialRow[] = [];
  let priorPnlNet = 0n;
  for (const a of accounts) {
    const before = sumFor(allBefore, a.id);
    const allNet = before.debit - before.credit;
    let openingNet = allNet;
    if (isPnl(a.type)) {
      const fy = sumFor(fiscalPre, a.id);
      openingNet = fy.debit - fy.credit;
      priorPnlNet += allNet - openingNet;
    }
    const p = sumFor(period, a.id);
    const closingNet = openingNet + p.debit - p.credit;
    const o = splitNet(openingNet);
    const c = splitNet(closingNet);
    const hasActivity = openingNet !== 0n || p.debit !== 0n || p.credit !== 0n;
    if (!hasActivity && a.type !== 'ASSET' && a.type !== 'LIABILITY' && a.type !== 'EQUITY') {
      // حساب درآمد/هزینه‌ی بدون هیچ گردشی در این دوره نمایش داده نمی‌شود (جلوگیری از ردیف‌های صفر)
      continue;
    }
    rows.push({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      openingDebit: o.debit,
      openingCredit: o.credit,
      periodDebit: toNum(p.debit),
      periodCredit: toNum(p.credit),
      closingDebit: c.debit,
      closingCredit: c.credit,
      balance: natural(a.type, closingNet),
      openingBalance: natural(a.type, openingNet),
      debit: toNum(p.debit),
      credit: toNum(p.credit),
    });
  }
  if (priorPnlNet !== 0n) {
    const o = splitNet(priorPnlNet);
    rows.push({
      accountId: RETAINED_PRIOR_ID,
      code: '—',
      name: 'سود و زیان انباشته سال‌های قبل',
      type: 'EQUITY',
      openingDebit: o.debit,
      openingCredit: o.credit,
      periodDebit: 0,
      periodCredit: 0,
      closingDebit: o.debit,
      closingCredit: o.credit,
      balance: natural('EQUITY', priorPnlNet),
      openingBalance: natural('EQUITY', priorPnlNet),
      debit: 0,
      credit: 0,
    });
  }
  const tot = (k: keyof TrialRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const totals = {
    openingDebit: tot('openingDebit'),
    openingCredit: tot('openingCredit'),
    periodDebit: tot('periodDebit'),
    periodCredit: tot('periodCredit'),
    closingDebit: tot('closingDebit'),
    closingCredit: tot('closingCredit'),
  };
  return {
    rows,
    totals,
    totalDebit: totals.periodDebit,
    totalCredit: totals.periodCredit,
    balanced:
      totals.openingDebit === totals.openingCredit && totals.periodDebit === totals.periodCredit && totals.closingDebit === totals.closingCredit,
  };
}

// ── ترازنامه ────────────────────────────────────────────────────────────────

/**
 * allToAsOf: جمع تجمعی همه‌ی اسناد تا تاریخ؛ fiscalToAsOf: جمع از ابتدای سال مالی تا همان تاریخ.
 * سود جاری = درآمد−هزینه‌ی سال مالی جاری؛ سود سال‌های قبل = بقیه‌ی سود/زیان تجمعی.
 */
export function computeBalanceSheet(accounts: AccountLite[], allToAsOf: SumMap, fiscalToAsOf: SumMap) {
  const bal = (a: AccountLite, m: SumMap) => {
    const s = sumFor(m, a.id);
    return s.debit - s.credit;
  };
  const toRow = (a: AccountLite) => ({ accountId: a.id, code: a.code, name: a.name, amount: natural(a.type, bal(a, allToAsOf)) });
  const assetRows = accounts.filter((a) => a.type === 'ASSET').map(toRow);
  const liabilityRows = accounts.filter((a) => a.type === 'LIABILITY').map(toRow);
  const equityRows = accounts.filter((a) => a.type === 'EQUITY').map(toRow);
  let allPnlNet = 0n; // خالص بدهکار−بستانکار (منفی = سود)
  let fyPnlNet = 0n;
  for (const a of accounts) {
    if (!isPnl(a.type)) continue;
    allPnlNet += bal(a, allToAsOf);
    fyPnlNet += bal(a, fiscalToAsOf);
  }
  const retainedEarnings = toNum(-allPnlNet);
  const currentYearEarnings = toNum(-fyPnlNet);
  const priorYearsEarnings = retainedEarnings - currentYearEarnings;
  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equityRows.reduce((s, r) => s + r.amount, 0) + retainedEarnings;
  return {
    assetRows,
    liabilityRows,
    equityRows,
    retainedEarnings,
    currentYearEarnings,
    priorYearsEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balances: totalAssets === totalLiabilities + totalEquity,
  };
}

// ── دفتر حساب با مانده‌ی ابتدای دوره ─────────────────────────────────────────

export type LedgerLine = { id: string; entryNumber: number; date: Date; description: string | null; debit: number; credit: number };

/** openingNet = خالص بدهکار−بستانکار پیش از دوره (با قاعده‌ی سال مالی برای درآمد/هزینه، از بیرون محاسبه می‌شود). */
export function computeLedger(type: AccountType, openingNet: bigint, lines: LedgerLine[]) {
  const sign = isDebitNature(type) ? 1 : -1;
  const opening = toNum(openingNet) * sign;
  let running = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = lines.map((l) => {
    running += sign * (l.debit - l.credit);
    totalDebit += l.debit;
    totalCredit += l.credit;
    return { ...l, runningBalance: running };
  });
  return { opening, closing: running, totalDebit, totalCredit, rows };
}

// ── مقایسه‌ی ماه‌ها ─────────────────────────────────────────────────────────

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export type CompareMonthInput = { key: string; label: string; sums: SumMap };

export function buildComparison(accounts: AccountLite[], months: CompareMonthInput[]) {
  const stmts = months.map((m) => computeIncomeStatement(accounts, m.sums));
  const deltas = (vals: number[]) => vals.map((v, i) => (i === 0 ? null : { amount: v - vals[i - 1], pct: pctChange(v, vals[i - 1]) }));
  const summary = months.map((m, i) => ({
    key: m.key,
    label: m.label,
    revenue: stmts[i].totalRevenue,
    cogs: stmts[i].totalCogs,
    opex: stmts[i].totalOpex,
    expense: stmts[i].totalExpense,
    grossProfit: stmts[i].grossProfit,
    netIncome: stmts[i].netIncome,
  }));
  const lineSeries = (pick: (s: (typeof summary)[number]) => number) => {
    const values = summary.map(pick);
    return { values, changes: deltas(values) };
  };
  const accountRows = accounts
    .filter((a) => incomeGroup(a.type, a.code))
    .map((a) => {
      const values = stmts.map((_, i) => {
        const s = sumFor(months[i].sums, a.id);
        return natural(a.type, s.debit - s.credit);
      });
      return { accountId: a.id, code: a.code, name: a.name, group: incomeGroup(a.type, a.code)!, values, changes: deltas(values) };
    })
    .filter((r) => r.values.some((v) => v !== 0));
  return {
    months: summary,
    totals: {
      revenue: lineSeries((s) => s.revenue),
      cogs: lineSeries((s) => s.cogs),
      opex: lineSeries((s) => s.opex),
      grossProfit: lineSeries((s) => s.grossProfit),
      netIncome: lineSeries((s) => s.netIncome),
    },
    accountRows,
  };
}
