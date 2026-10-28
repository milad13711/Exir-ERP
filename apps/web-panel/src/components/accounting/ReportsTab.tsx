"use client";

import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { formatToman, formatNumber, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import { isManager } from "@/lib/access";
import { downloadCsv, type CsvCell } from "@/lib/csv";
import {
  fetchTrialBalanceReport,
  fetchIncomeStatementReport,
  fetchBalanceSheetReport,
  fetchCashMovement,
  fetchCompare,
  type PeriodSel,
  type CashMovementReport,
  type CompareReport,
  type Change,
} from "@/lib/accounting-api";
import { PeriodPicker, currentMonthKey } from "./PeriodPicker";
import { useKeyedLoad } from "./use-keyed-load";
import { TrendChart } from "./TrendChart";

type ReportKind = "income-statement" | "trial-balance" | "balance-sheet" | "cash" | "compare";

const REPORT_LABELS: Record<ReportKind, string> = {
  "income-statement": "سود و زیان",
  "trial-balance": "تراز آزمایشی",
  "balance-sheet": "ترازنامه",
  cash: "گردش بانک و صندوق",
  compare: "مقایسه ماه‌ها",
};

/** بارگذاری یک گزارش با حالت‌های loading/error و جلوگیری از رقابت پاسخ‌های قدیمی. */
function useReport<T>(load: () => Promise<T>, deps: unknown[]) {
  return useKeyedLoad<T>(JSON.stringify(deps), load);
}

function Status({ loading, error, empty, children }: { loading: boolean; error: string | null; empty?: boolean; children: ReactNode }) {
  if (loading) return <div className="p-8 text-center text-muted text-sm" role="status">در حال بارگذاری...</div>;
  if (error) return <div className="p-6 text-center text-danger text-sm" role="alert">{error}</div>;
  if (empty) return <div className="p-8 text-center text-muted text-sm">در این بازه هیچ گردشی ثبت نشده است.</div>;
  return <>{children}</>;
}

function Toolbar({ title, subtitle, onCsv }: { title: string; subtitle: string; onCsv: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
      <div>
        <h3 className="text-[15px] font-extrabold">{title}</h3>
        <div className="text-[12.5px] text-muted mt-0.5">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2 print:hidden">
        <button type="button" onClick={onCsv} className="min-h-[40px] px-3.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer">
          خروجی CSV
        </button>
        <button type="button" onClick={() => window.print()} className="min-h-[40px] px-3.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer">
          چاپ
        </button>
      </div>
    </div>
  );
}

export function ReportsTab({ initialMonthKey }: { initialMonthKey?: string }) {
  const { me } = useWorkspace();
  const [kind, setKind] = useState<ReportKind>("income-statement");
  const [sel, setSel] = useState<PeriodSel>({ mode: "month", key: initialMonthKey ?? currentMonthKey() });
  const allowed: Array<PeriodSel["mode"]> = kind === "balance-sheet" ? ["month", "fiscal", "all", "custom"] : kind === "compare" ? ["month"] : ["month", "fiscal", "all", "custom"];

  function pick(k: ReportKind) {
    setKind(k);
    if (k === "compare" && sel.mode !== "month") setSel({ mode: "month", key: currentMonthKey() });
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-4 overflow-x-auto print:hidden" role="tablist" aria-label="نوع گزارش">
        {(Object.keys(REPORT_LABELS) as ReportKind[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={kind === key}
            onClick={() => pick(key)}
            className={clsx("min-h-[40px] text-[12.5px] font-bold px-3.5 rounded-lg cursor-pointer shrink-0 whitespace-nowrap", kind === key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
          >
            {REPORT_LABELS[key]}
          </button>
        ))}
      </div>

      <PeriodPicker value={sel} onChange={setSel} allowedModes={allowed} canManage={isManager(me)} className="mb-4" />
      {kind === "compare" ? <p className="text-[12px] text-muted mb-3 print:hidden">ماه انتخاب‌شده آخرین ستون مقایسه است؛ ماه‌های قبل از آن کنار هم چیده می‌شوند.</p> : null}

      {kind === "trial-balance" ? <TrialBalanceView sel={sel} /> : null}
      {kind === "income-statement" ? <IncomeStatementView sel={sel} /> : null}
      {kind === "balance-sheet" ? <BalanceSheetView sel={sel} /> : null}
      {kind === "cash" ? <CashView sel={sel} /> : null}
      {kind === "compare" ? <CompareView endKey={sel.mode === "month" ? sel.key : currentMonthKey()} /> : null}
    </div>
  );
}

const th = "text-start text-[11px] text-muted font-semibold py-2.5 px-3 whitespace-nowrap";
const td = "py-2.5 px-3 text-[12px] whitespace-nowrap";
const money = (v: number) => (v ? formatNumber(v) : "—");

function periodRange(p: { from: string; to: string | null; label: string }): string {
  return p.to ? `${p.label} — ${formatJalaliDate(p.from)} تا ${formatJalaliDate(p.to)}` : p.label;
}

// ── تراز آزمایشی ────────────────────────────────────────────────────────────

function TrialBalanceView({ sel }: { sel: PeriodSel }) {
  const { data, error, loading } = useReport(() => fetchTrialBalanceReport(sel), [JSON.stringify(sel)]);
  const csv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [["کد", "حساب", "مانده ابتدا بدهکار", "مانده ابتدا بستانکار", "گردش بدهکار", "گردش بستانکار", "مانده پایان بدهکار", "مانده پایان بستانکار"]];
    for (const r of data.rows) rows.push([r.code, r.name, r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingDebit, r.closingCredit]);
    const t = data.totals;
    rows.push(["", "جمع کل", t.openingDebit, t.openingCredit, t.periodDebit, t.periodCredit, t.closingDebit, t.closingCredit]);
    downloadCsv(`trial-balance-${data.period.key ?? data.period.mode}.csv`, rows);
  };
  return (
    <Status loading={loading} error={error} empty={!!data && data.rows.length === 0}>
      {data ? (
        <Card className="p-4 sm:p-5">
          <Toolbar title="تراز آزمایشی" subtitle={periodRange(data.period)} onCsv={csv} />
          <p className="text-[11.5px] text-muted mb-3 leading-6">
            مانده ابتدای دوره: حساب‌های دارایی/بدهی/حقوق صاحبان سهام از ماه‌های قبل منتقل می‌شوند؛ درآمد و هزینه از ابتدای سال مالی جمع می‌شوند (ابتدای سال مالی صفر) و سود و زیان سال‌های قبل در ردیف «سود و زیان انباشته» می‌آید.
          </p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full border-collapse min-w-[760px]">
              <thead>
                <tr className="border-b border-border text-center">
                  <th rowSpan={2} className={th}>حساب</th>
                  <th colSpan={2} className={clsx(th, "text-center")}>مانده ابتدای دوره</th>
                  <th colSpan={2} className={clsx(th, "text-center")}>گردش دوره</th>
                  <th colSpan={2} className={clsx(th, "text-center")}>مانده پایان دوره</th>
                </tr>
                <tr className="border-b border-border">
                  {["بدهکار", "بستانکار", "بدهکار", "بستانکار", "بدهکار", "بستانکار"].map((h, i) => (
                    <th key={i} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.accountId} className="border-b border-border last:border-b-0">
                    <td className={clsx(td, "font-bold")}>{r.name} <span className="text-muted font-normal">({toPersianDigits(r.code)})</span></td>
                    <td className={td}>{money(r.openingDebit)}</td>
                    <td className={td}>{money(r.openingCredit)}</td>
                    <td className={td}>{money(r.periodDebit)}</td>
                    <td className={td}>{money(r.periodCredit)}</td>
                    <td className={clsx(td, "font-bold")}>{money(r.closingDebit)}</td>
                    <td className={clsx(td, "font-bold")}>{money(r.closingCredit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-extrabold">
                  <td className={td}>جمع کل</td>
                  <td className={td}>{formatNumber(data.totals.openingDebit)}</td>
                  <td className={td}>{formatNumber(data.totals.openingCredit)}</td>
                  <td className={td}>{formatNumber(data.totals.periodDebit)}</td>
                  <td className={td}>{formatNumber(data.totals.periodCredit)}</td>
                  <td className={td}>{formatNumber(data.totals.closingDebit)}</td>
                  <td className={td}>{formatNumber(data.totals.closingCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className={clsx("mt-3 rounded-xl px-4 py-2.5 text-[12.5px] font-bold", data.balanced ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            {data.balanced ? "تراز متوازن است" : "تراز نامتوازن است — اسناد را بررسی کنید"}
          </div>
        </Card>
      ) : null}
    </Status>
  );
}

// ── سود و زیان ──────────────────────────────────────────────────────────────

function Section({ title, tone, rows, total, totalLabel }: { title: string; tone: string; rows: Array<{ accountId: string; name: string; amount: number }>; total: number; totalLabel: string }) {
  return (
    <div className="mb-4">
      <div className={clsx("text-[12px] font-bold mb-2", tone)}>{title}</div>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 ? <div className="text-[12px] text-muted">موردی ثبت نشده</div> : null}
        {rows.map((r) => (
          <div key={r.accountId} className="flex justify-between text-[12.5px] gap-3">
            <span className="text-ink-soft">{r.name}</span>
            <span className="font-bold">{formatToman(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[13px] font-extrabold border-t border-border pt-1.5 mt-1 gap-3">
          <span>{totalLabel}</span>
          <span>{formatToman(total)}</span>
        </div>
      </div>
    </div>
  );
}

function Highlight({ label, value }: { label: string; value: number }) {
  return (
    <div className={clsx("flex justify-between text-[14px] font-extrabold rounded-xl px-4 py-3 mb-3 gap-3", value >= 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
      <span>{label}</span>
      <span>{formatToman(value)}</span>
    </div>
  );
}

function IncomeStatementView({ sel }: { sel: PeriodSel }) {
  const { data, error, loading } = useReport(() => fetchIncomeStatementReport(sel), [JSON.stringify(sel)]);
  const empty = !!data && data.revenueRows.every((r) => !r.amount) && data.cogsRows.every((r) => !r.amount) && data.opexRows.every((r) => !r.amount);
  const csv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [["گروه", "کد", "حساب", "مبلغ (تومان)"]];
    for (const r of data.revenueRows) rows.push(["درآمد", r.code, r.name, r.amount]);
    rows.push(["", "", "جمع درآمد", data.totalRevenue]);
    for (const r of data.cogsRows) rows.push(["بهای تمام‌شده", r.code, r.name, r.amount]);
    rows.push(["", "", "سود ناخالص", data.grossProfit]);
    for (const r of data.opexRows) rows.push(["هزینه‌ها", r.code, r.name, r.amount]);
    rows.push(["", "", "جمع هزینه‌های عملیاتی", data.totalOpex]);
    rows.push(["", "", "سود (زیان) خالص", data.netIncome]);
    downloadCsv(`income-statement-${data.period.key ?? data.period.mode}.csv`, rows);
  };
  return (
    <Status loading={loading} error={error} empty={empty}>
      {data ? (
        <Card className="p-4 sm:p-5">
          <Toolbar title="صورت سود و زیان" subtitle={periodRange(data.period)} onCsv={csv} />
          <Section title="درآمدها" tone="text-success" rows={data.revenueRows.filter((r) => r.amount)} total={data.totalRevenue} totalLabel="جمع درآمد" />
          <Section title="بهای تمام‌شده" tone="text-warning" rows={data.cogsRows.filter((r) => r.amount)} total={data.totalCogs} totalLabel="جمع بهای تمام‌شده" />
          <Highlight label="سود (زیان) ناخالص" value={data.grossProfit} />
          <Section title="هزینه‌های عملیاتی و اداری" tone="text-danger" rows={data.opexRows.filter((r) => r.amount)} total={data.totalOpex} totalLabel="جمع هزینه‌ها" />
          <Highlight label="سود (زیان) خالص" value={data.netIncome} />
        </Card>
      ) : null}
    </Status>
  );
}

// ── ترازنامه ────────────────────────────────────────────────────────────────

function BalanceSheetView({ sel }: { sel: PeriodSel }) {
  const { data, error, loading } = useReport(() => fetchBalanceSheetReport(sel), [JSON.stringify(sel)]);
  const csv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [["بخش", "کد", "حساب", "مبلغ (تومان)"]];
    for (const r of data.assetRows) rows.push(["دارایی", r.code, r.name, r.amount]);
    rows.push(["", "", "جمع دارایی‌ها", data.totalAssets]);
    for (const r of data.liabilityRows) rows.push(["بدهی", r.code, r.name, r.amount]);
    rows.push(["", "", "جمع بدهی‌ها", data.totalLiabilities]);
    for (const r of data.equityRows) rows.push(["حقوق صاحبان سهام", r.code, r.name, r.amount]);
    rows.push(["حقوق صاحبان سهام", "", "سود سال مالی جاری", data.currentYearEarnings]);
    rows.push(["حقوق صاحبان سهام", "", "سود (زیان) انباشته سال‌های قبل", data.priorYearsEarnings]);
    rows.push(["", "", "جمع حقوق صاحبان سهام", data.totalEquity]);
    downloadCsv(`balance-sheet-${data.asOf.slice(0, 10)}.csv`, rows);
  };
  return (
    <Status loading={loading} error={error}>
      {data ? (
        <Card className="p-4 sm:p-5">
          <Toolbar title="ترازنامه" subtitle={`وضعیت تجمیعی تا ${formatJalaliDate(data.asOf)}`} onCsv={csv} />
          <Section title="دارایی‌ها" tone="text-primary" rows={data.assetRows} total={data.totalAssets} totalLabel="جمع دارایی‌ها" />
          <Section title="بدهی‌ها" tone="text-warning" rows={data.liabilityRows} total={data.totalLiabilities} totalLabel="جمع بدهی‌ها" />
          <Section
            title="حقوق صاحبان سهام"
            tone="text-ink-soft"
            rows={[
              ...data.equityRows,
              { accountId: "cy", name: "سود (زیان) سال مالی جاری", amount: data.currentYearEarnings },
              { accountId: "py", name: "سود (زیان) انباشته سال‌های قبل", amount: data.priorYearsEarnings },
            ]}
            total={data.totalEquity}
            totalLabel="جمع حقوق صاحبان سهام"
          />
          <div className={clsx("flex items-center justify-between text-[12.5px] font-bold rounded-xl px-4 py-2.5", data.balances ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            <span>دارایی‌ها = بدهی‌ها + حقوق صاحبان سهام</span>
            <span>{data.balances ? "متوازن" : "نامتوازن"}</span>
          </div>
          <p className="text-[11.5px] text-muted mt-3">ترازنامه ذاتاً تجمیعی است: وضعیت دارایی و بدهی در پایان دوره‌ی انتخابی، نه فقط گردش همان ماه.</p>
        </Card>
      ) : null}
    </Status>
  );
}

// ── گردش بانک و صندوق ──────────────────────────────────────────────────────

function CashView({ sel }: { sel: PeriodSel }) {
  const { data, error, loading } = useReport<CashMovementReport>(() => fetchCashMovement(sel), [JSON.stringify(sel)]);
  const csv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [["حساب", "نوع", "مانده ابتدا", "ورودی", "خروجی", "خالص", "مانده پایان"]];
    for (const r of data.rows) rows.push([r.name, r.holder ? (r.holder.kind === "BANK" ? "بانک" : "صندوق") : "حساب نقدی", r.opening, r.inflow, r.outflow, r.net, r.closing]);
    const t = data.totals;
    rows.push(["جمع", "", t.opening, t.inflow, t.outflow, t.net, t.closing]);
    downloadCsv(`cash-movement-${data.period.key ?? data.period.mode}.csv`, rows);
  };
  return (
    <Status loading={loading} error={error} empty={!!data && data.rows.length === 0}>
      {data ? (
        <Card className="p-4 sm:p-5">
          <Toolbar title="گردش بانک و صندوق" subtitle={periodRange(data.period)} onCsv={csv} />
          <div className="overflow-x-auto -mx-1">
            <table className="w-full border-collapse min-w-[620px]">
              <thead>
                <tr className="border-b border-border">
                  {["حساب", "مانده ابتدا", "ورودی", "خروجی", "خالص", "مانده پایان"].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.accountId} className="border-b border-border last:border-b-0">
                    <td className={clsx(td, "font-bold")}>{r.holder?.name ?? r.name}</td>
                    <td className={td}>{formatNumber(r.opening)}</td>
                    <td className={clsx(td, "text-success")}>{money(r.inflow)}</td>
                    <td className={clsx(td, "text-danger")}>{money(r.outflow)}</td>
                    <td className={td}>{formatNumber(r.net)}</td>
                    <td className={clsx(td, "font-bold")}>{formatNumber(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-extrabold">
                  <td className={td}>جمع</td>
                  <td className={td}>{formatNumber(data.totals.opening)}</td>
                  <td className={td}>{formatNumber(data.totals.inflow)}</td>
                  <td className={td}>{formatNumber(data.totals.outflow)}</td>
                  <td className={td}>{formatNumber(data.totals.net)}</td>
                  <td className={td}>{formatNumber(data.totals.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ) : null}
    </Status>
  );
}

// ── مقایسه ماه‌ها ───────────────────────────────────────────────────────────

function Delta({ c }: { c: Change }) {
  if (!c) return <span className="text-muted">—</span>;
  const up = c.amount > 0;
  const zero = c.amount === 0;
  return (
    <span className={clsx("text-[10.5px] font-semibold", zero ? "text-muted" : up ? "text-success" : "text-danger")} dir="ltr">
      {zero ? "0" : `${up ? "+" : "-"}${formatNumber(Math.abs(c.amount))}`}
      {c.pct !== null ? ` (${toPersianDigits(Math.abs(c.pct))}%)` : ""}
    </span>
  );
}

function CompareView({ endKey }: { endKey: string }) {
  const [count, setCount] = useState(6);
  const [yoy, setYoy] = useState(false);
  const [byAccount, setByAccount] = useState(false);
  const { data, error, loading } = useReport<CompareReport>(() => fetchCompare(endKey, count, yoy), [endKey, count, yoy]);

  const points = useMemo(() => {
    if (!data) return [];
    const sameYear = new Set(data.months.map((m) => m.key.slice(0, 4))).size === 1;
    return data.months.map((m) => ({
      label: sameYear ? m.label.split(" ")[0] : `${m.label.split(" ")[0]} ${m.label.split(" ")[1]?.slice(-2) ?? ""}`,
      revenue: m.revenue,
      expense: m.expense,
      net: m.netIncome,
    }));
  }, [data]);

  const csv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [["ردیف", ...data.months.map((m) => m.label)]];
    const t = data.totals;
    const line = (name: string, s: { values: number[] }) => rows.push([name, ...s.values]);
    line("درآمد", t.revenue);
    line("بهای تمام‌شده", t.cogs);
    line("سود ناخالص", t.grossProfit);
    line("هزینه‌های عملیاتی", t.opex);
    line("سود (زیان) خالص", t.netIncome);
    if (byAccount) for (const r of data.accountRows) rows.push([`${r.code} ${r.name}`, ...r.values]);
    downloadCsv(`monthly-compare-${endKey}.csv`, rows);
  };

  const lines: Array<[string, keyof CompareReport["totals"], boolean]> = [
    ["درآمد", "revenue", false],
    ["بهای تمام‌شده", "cogs", false],
    ["سود ناخالص", "grossProfit", true],
    ["هزینه‌های عملیاتی", "opex", false],
    ["سود (زیان) خالص", "netIncome", true],
  ];

  return (
    <Status loading={loading} error={error}>
      {data ? (
        <div className="flex flex-col gap-4">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3 print:hidden">
              <div className="flex items-center gap-1.5">
                {[3, 6, 12].map((n) => (
                  <button key={n} type="button" onClick={() => setCount(n)} className={clsx("min-h-[40px] px-3.5 rounded-lg text-[12.5px] font-bold cursor-pointer", count === n ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}>
                    {toPersianDigits(n)} ماه
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer min-h-[40px]">
                <input type="checkbox" checked={yoy} onChange={(e) => setYoy(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary)]" />
                مقایسه با همین ماه‌ها در سال قبل
              </label>
            </div>
            <h3 className="text-[15px] font-extrabold mb-2">روند درآمد، هزینه و سود</h3>
            {data.months.every((m) => m.revenue === 0 && m.expense === 0) ? <div className="p-6 text-center text-muted text-sm">در این ماه‌ها هیچ گردشی ثبت نشده است.</div> : <TrendChart points={points} />}
          </Card>

          <Card className="p-4 sm:p-5">
            <Toolbar title="مقایسه‌ی ماه‌به‌ماه" subtitle="تغییر هر ماه نسبت به ماه قبل (مبلغ و درصد)" onCsv={csv} />
            <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer min-h-[40px] print:hidden">
              <input type="checkbox" checked={byAccount} onChange={(e) => setByAccount(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary)]" />
              نمایش به تفکیک حساب
            </label>
            <div className="overflow-x-auto -mx-1 mt-1">
              <table className="w-full border-collapse" style={{ minWidth: 140 + data.months.length * 120 }}>
                <thead>
                  <tr className="border-b border-border">
                    <th className={clsx(th, "sticky start-0 bg-surface")}>ردیف</th>
                    {data.months.map((m) => (
                      <th key={m.key} className={th}>
                        {m.label} {m.locked ? <span className="text-warning font-normal">(بسته)</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(([name, key, strong]) => (
                    <tr key={key} className={clsx("border-b border-border", strong && "bg-slate-50")}>
                      <td className={clsx(td, "font-bold sticky start-0", strong ? "bg-slate-50" : "bg-surface")}>{name}</td>
                      {data.totals[key].values.map((v, i) => (
                        <td key={i} className={td}>
                          <div className={clsx("font-bold", strong && v < 0 && "text-danger")}>{formatNumber(v)}</div>
                          <Delta c={data.totals[key].changes[i]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {byAccount
                    ? data.accountRows.map((r) => (
                        <tr key={r.accountId} className="border-b border-border last:border-b-0">
                          <td className={clsx(td, "sticky start-0 bg-surface")}>
                            <span className="text-ink-soft">{r.name}</span> <span className="text-muted">({toPersianDigits(r.code)})</span>
                          </td>
                          {r.values.map((v, i) => (
                            <td key={i} className={td}>
                              <div>{money(v)}</div>
                              <Delta c={r.changes[i]} />
                            </td>
                          ))}
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
            </div>
          </Card>

          {yoy && data.yoy ? (
            <Card className="p-4 sm:p-5">
              <h3 className="text-[15px] font-extrabold mb-1">مقایسه با سال قبل</h3>
              <p className="text-[12px] text-muted mb-3">همین ماه در سال مالی قبل (در صورت وجود اطلاعات)</p>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full border-collapse min-w-[560px]">
                  <thead>
                    <tr className="border-b border-border">
                      {["ماه", "درآمد پارسال", "تغییر درآمد", "سود خالص پارسال", "تغییر سود"].map((h) => (
                        <th key={h} className={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.yoy.map((y, i) => (
                      <tr key={y.key} className="border-b border-border last:border-b-0">
                        <td className={clsx(td, "font-bold")}>{data.months[i].label}</td>
                        {y.hasData ? (
                          <>
                            <td className={td}>{formatNumber(y.revenue)}</td>
                            <td className={td} dir="ltr">{y.revenueChange === null ? "—" : `${y.revenueChange > 0 ? "+" : ""}${toPersianDigits(y.revenueChange)}%`}</td>
                            <td className={td}>{formatNumber(y.netIncome)}</td>
                            <td className={td} dir="ltr">{y.netIncomeChange === null ? "—" : `${y.netIncomeChange > 0 ? "+" : ""}${toPersianDigits(y.netIncomeChange)}%`}</td>
                          </>
                        ) : (
                          <td colSpan={4} className={clsx(td, "text-muted")}>اطلاعاتی برای سال قبل ثبت نشده است</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </Status>
  );
}

