import { apiFetch, type JournalEntry } from "./api";

// ── انتخاب دوره (ماه جلالی / سال مالی / تجمیعی / بازه) ─────────────────────

export type PeriodSel =
  | { mode: "month"; key: string }
  | { mode: "fiscal"; fiscalYear: number }
  | { mode: "all" }
  | { mode: "custom"; from: string; to: string };

export function periodParams(sel: PeriodSel): URLSearchParams {
  const p = new URLSearchParams();
  if (sel.mode === "month") p.set("period", sel.key);
  else if (sel.mode === "fiscal") p.set("fiscalYear", String(sel.fiscalYear));
  else if (sel.mode === "all") p.set("period", "all");
  else {
    if (sel.from) p.set("from", sel.from);
    if (sel.to) p.set("to", sel.to);
  }
  return p;
}

export function qs(params: URLSearchParams | Record<string, string | undefined>): string {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type PeriodMeta = { mode: string; key: string | null; label: string; from: string; to: string | null; fiscalYear: number; locked: boolean };

export type PeriodMonth = {
  key: string;
  year: number;
  month: number;
  label: string;
  days: number;
  from: string;
  to: string;
  locked: boolean;
  lockedAt: string | null;
  lockNote: string | null;
};
export type PeriodsInfo = {
  startMonth: number;
  fiscalYear: number;
  currentFiscalYear: number;
  currentKey: string;
  fiscalYears: number[];
  months: PeriodMonth[];
};

export const fetchPeriods = (fiscalYear?: number) => apiFetch<PeriodsInfo>(`/accounting/periods${fiscalYear ? `?fiscalYear=${fiscalYear}` : ""}`);
export const lockPeriod = (key: string, note?: string) => apiFetch<{ key: string; locked: boolean; draftsInPeriod: number }>(`/accounting/periods/${key}/lock`, { method: "POST", body: JSON.stringify({ note }) });
export const unlockPeriod = (key: string, reason: string) => apiFetch<{ key: string; locked: boolean }>(`/accounting/periods/${key}/unlock`, { method: "POST", body: JSON.stringify({ reason }) });
export const updateFiscalStartMonth = (startMonth: number) => apiFetch<{ startMonth: number }>("/accounting/periods/settings", { method: "PUT", body: JSON.stringify({ startMonth }) });

// ── خلاصه و گزارش‌ها ───────────────────────────────────────────────────────

export type PeriodSummary = {
  cashBalance: number;
  monthRevenue: number;
  monthExpense: number;
  monthNetIncome: number;
  monthGrossProfit: number;
  draftCount: number;
  period: { mode: string; key: string | null; label: string; locked: boolean };
};
export const fetchPeriodSummary = (sel: PeriodSel) => apiFetch<PeriodSummary>(`/accounting/summary${qs(periodParams(sel))}`);

export type TrialRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};
export type TrialBalanceReport = {
  period: PeriodMeta;
  rows: TrialRow[];
  totals: { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number; closingDebit: number; closingCredit: number };
  balanced: boolean;
};
export const fetchTrialBalanceReport = (sel: PeriodSel) => apiFetch<TrialBalanceReport>(`/accounting/reports/trial-balance${qs(periodParams(sel))}`);

export type PnlRow = { accountId: string; code: string; name: string; amount: number };
export type IncomeStatementReport = {
  period: PeriodMeta;
  revenueRows: PnlRow[];
  cogsRows: PnlRow[];
  opexRows: PnlRow[];
  totalRevenue: number;
  totalCogs: number;
  totalOpex: number;
  grossProfit: number;
  netIncome: number;
};
export const fetchIncomeStatementReport = (sel: PeriodSel) => apiFetch<IncomeStatementReport>(`/accounting/reports/income-statement${qs(periodParams(sel))}`);

export type BalanceSheetReport = {
  asOf: string;
  asOfLabel: string;
  assetRows: PnlRow[];
  liabilityRows: PnlRow[];
  equityRows: PnlRow[];
  retainedEarnings: number;
  currentYearEarnings: number;
  priorYearsEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balances: boolean;
};
export const fetchBalanceSheetReport = (sel: PeriodSel) => apiFetch<BalanceSheetReport>(`/accounting/reports/balance-sheet${qs(periodParams(sel))}`);

export type CashMovementReport = {
  period: PeriodMeta;
  rows: Array<{ accountId: string; code: string; name: string; holder: { kind: "BANK" | "CASH_BOX"; id: string; name: string } | null; opening: number; inflow: number; outflow: number; net: number; closing: number }>;
  totals: { opening: number; inflow: number; outflow: number; net: number; closing: number };
};
export const fetchCashMovement = (sel: PeriodSel) => apiFetch<CashMovementReport>(`/accounting/reports/cash-movement${qs(periodParams(sel))}`);

export type Change = { amount: number; pct: number | null } | null;
export type Series = { values: number[]; changes: Change[] };
export type CompareReport = {
  months: Array<{ key: string; label: string; revenue: number; cogs: number; opex: number; expense: number; grossProfit: number; netIncome: number; locked: boolean }>;
  totals: { revenue: Series; cogs: Series; opex: Series; grossProfit: Series; netIncome: Series };
  accountRows: Array<{ accountId: string; code: string; name: string; group: "REVENUE" | "COGS" | "OPEX"; values: number[]; changes: Change[] }>;
  yoy: Array<{ key: string; label: string; hasData: boolean; revenue: number; expense: number; netIncome: number; revenueChange: number | null; netIncomeChange: number | null }> | null;
};
export const fetchCompare = (endKey: string, count: number, yoy: boolean) =>
  apiFetch<CompareReport>(`/accounting/reports/compare${qs({ end: endKey, count: String(count), yoy: yoy ? "1" : undefined })}`);

// ── دفتر حساب دوره‌ای ─────────────────────────────────────────────────────

export type PeriodLedger = {
  account: { id: string; code: string; name: string; type: string; balance: number };
  period: { mode: string; key: string | null; label: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  rows: Array<{ id: string; entryNumber: number; date: string; description: string | null; debit: number; credit: number; runningBalance: number }>;
};
export const fetchPeriodLedger = (accountId: string, sel: PeriodSel) => apiFetch<PeriodLedger>(`/accounting/accounts/${accountId}/ledger${qs(periodParams(sel))}`);

// ── بانک، صندوق، دسته‌چک، تراکنش ───────────────────────────────────────────

const B = "/accounting/banking";
const json = (data: unknown) => JSON.stringify(data);

export type BankAccountRow = {
  id: string;
  name: string;
  bankName: string | null;
  branch: string | null;
  accountNumber: string | null;
  sheba: string | null;
  cardNumber: string | null;
  currency: string;
  openingBalance: number;
  openingDate: string;
  linkedAccountId: string;
  linkedAccount: { id: string; code: string; name: string };
  isActive: boolean;
  balance: number;
};
export type BankInput = { name: string; bankName?: string; branch?: string; accountNumber?: string; sheba?: string; cardNumber?: string; currency?: string; openingBalance?: number; openingDate?: string; linkedAccountId?: string };
export const fetchBanks = () => apiFetch<BankAccountRow[]>(`${B}/banks`);
export const createBank = (d: BankInput) => apiFetch<BankAccountRow>(`${B}/banks`, { method: "POST", body: json(d) });
export const updateBank = (id: string, d: Partial<BankInput> & { isActive?: boolean }) => apiFetch<BankAccountRow>(`${B}/banks/${id}`, { method: "PUT", body: json(d) });

export type CashBoxRow = {
  id: string;
  name: string;
  custodianUserId: string | null;
  custodianName: string | null;
  openingBalance: number;
  linkedAccountId: string;
  linkedAccount: { id: string; code: string; name: string };
  isActive: boolean;
  balance: number;
};
export const fetchCashBoxes = () => apiFetch<CashBoxRow[]>(`${B}/cash-boxes`);
export const createCashBox = (d: { name: string; custodianUserId?: string; openingBalance?: number; openingDate?: string; linkedAccountId?: string }) => apiFetch<CashBoxRow>(`${B}/cash-boxes`, { method: "POST", body: json(d) });
export const updateCashBox = (id: string, d: { name?: string; custodianUserId?: string; isActive?: boolean }) => apiFetch<CashBoxRow>(`${B}/cash-boxes/${id}`, { method: "PUT", body: json(d) });
export const seedDefaultCashBox = () => apiFetch<{ created: boolean; id: string }>(`${B}/cash-boxes/default`, { method: "POST" });

export type HolderStatement = {
  holder: { kind: "BANK" | "CASH"; id: string; name: string };
  account: { id: string; code: string; name: string };
  period: { mode: string; key: string | null; label: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  rows: Array<{
    id: string;
    entryNumber: number;
    date: string;
    description: string | null;
    debit: number;
    credit: number;
    runningBalance: number;
    reconciled: boolean;
    transaction: { id: string; number: number; type: string; status: string; referenceNo: string | null } | null;
  }>;
};
export const fetchHolderStatement = (kind: "BANK" | "CASH", id: string, sel: PeriodSel) =>
  apiFetch<HolderStatement>(`${B}/${kind === "BANK" ? "banks" : "cash-boxes"}/${id}/statement${qs(periodParams(sel))}`);
export const fetchHolderBalance = (kind: "BANK" | "CASH", id: string, asOf: string) =>
  apiFetch<{ id: string; name: string; asOf: string | null; balance: number }>(`${B}/${kind === "BANK" ? "banks" : "cash-boxes"}/${id}/balance${qs({ asOf })}`);

export type BankTx = {
  id: string;
  number: number;
  type: "RECEIPT" | "PAYMENT" | "TRANSFER";
  date: string;
  amount: number;
  description: string | null;
  referenceNo: string | null;
  status: "POSTED" | "VOIDED";
  voidReason: string | null;
  contactName: string | null;
  bankAccount: { name: string } | null;
  cashBox: { name: string } | null;
  toBankAccount: { name: string } | null;
  toCashBox: { name: string } | null;
};
export type BankTxInput = {
  type: "RECEIPT" | "PAYMENT" | "TRANSFER";
  date: string;
  amount: number;
  description?: string;
  referenceNo?: string;
  bankAccountId?: string;
  cashBoxId?: string;
  toBankAccountId?: string;
  toCashBoxId?: string;
  counterAccountId?: string;
  contactId?: string;
};
export const fetchBankTransactions = (filters: { bankAccountId?: string; cashBoxId?: string; type?: string; status?: string }, sel?: PeriodSel) => {
  const p = sel ? periodParams(sel) : new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  return apiFetch<BankTx[]>(`${B}/transactions${qs(p)}`);
};
export const createBankTransaction = (d: BankTxInput) => apiFetch<BankTx & { journalNumber: number }>(`${B}/transactions`, { method: "POST", body: json(d) });
export const voidBankTransaction = (id: string, reason: string) => apiFetch<{ success: boolean }>(`${B}/transactions/${id}/void`, { method: "POST", body: json({ reason }) });

export type LeafStatus = "UNUSED" | "ISSUED" | "CLEARED" | "BOUNCED" | "VOID" | "LOST";
export type ChequeBookRow = {
  id: string;
  bankAccountId: string;
  name: string;
  series: string | null;
  startSerial: number;
  endSerial: number;
  leafCount: number;
  status: "ACTIVE" | "EXHAUSTED" | "CLOSED";
  note: string | null;
  bankAccount: { name: string; bankName: string | null };
  counts: Record<string, number>;
  unused: number;
};
export type ChequeBookDetail = Omit<ChequeBookRow, "counts" | "unused" | "bankAccount"> & {
  bankAccount: { id: string; name: string; bankName: string | null };
  leaves: Array<{ id: string; serial: number; status: LeafStatus; statusNote: string | null; linkedCheck: { id: string; sayadId: string; amount: number; dueDate: string; status: string; contact: { name: string } | null } | null }>;
};
export type AvailableBook = { id: string; name: string; series: string | null; bankAccountId: string; bankAccountName: string; bankName: string | null; nextSerial: number | null; leaves: Array<{ id: string; serial: number }> };
export const fetchChequeBooks = (bankAccountId?: string) => apiFetch<ChequeBookRow[]>(`${B}/cheque-books${qs({ bankAccountId })}`);
export const fetchChequeBook = (id: string) => apiFetch<ChequeBookDetail>(`${B}/cheque-books/${id}`);
export const fetchAvailableLeaves = (bankAccountId?: string) => apiFetch<AvailableBook[]>(`${B}/cheque-books/available-leaves${qs({ bankAccountId })}`);
export const createChequeBook = (d: { bankAccountId: string; name: string; series?: string; startSerial: number; endSerial: number; note?: string }) => apiFetch<ChequeBookRow>(`${B}/cheque-books`, { method: "POST", body: json(d) });
export const updateChequeBook = (id: string, d: { name?: string; note?: string; status?: "ACTIVE" | "CLOSED" }) => apiFetch<ChequeBookDetail>(`${B}/cheque-books/${id}`, { method: "PUT", body: json(d) });
export const setLeafStatus = (leafId: string, status: "UNUSED" | "VOID" | "LOST", note?: string) => apiFetch<unknown>(`${B}/cheque-leaves/${leafId}/status`, { method: "POST", body: json({ status, note }) });

export const fetchEntriesByPeriod = (sel: PeriodSel) => apiFetch<JournalEntry[]>(`/accounting/entries${sel.mode === "all" ? "" : qs(periodParams(sel))}`);
