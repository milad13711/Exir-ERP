import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchTrialBalance,
  fetchIncomeStatement,
  fetchBalanceSheet,
  type TrialBalance,
  type IncomeStatement,
  type BalanceSheet,
} from "@/lib/api";
import { ACCOUNT_TYPE_LABELS } from "./accounting-shared";

type ReportKind = "trial-balance" | "income-statement" | "balance-sheet";

const REPORT_LABELS: Record<ReportKind, string> = {
  "trial-balance": "تراز آزمایشی",
  "income-statement": "سود و زیان",
  "balance-sheet": "ترازنامه",
};

export function ReportsTab() {
  const [kind, setKind] = useState<ReportKind>("trial-balance");

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-4">
        {(Object.keys(REPORT_LABELS) as ReportKind[]).map((key) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={clsx(
              "text-[12px] font-bold px-3.5 py-1.5 rounded-lg cursor-pointer",
              kind === key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {REPORT_LABELS[key]}
          </button>
        ))}
      </div>
      {kind === "trial-balance" ? <TrialBalanceView /> : null}
      {kind === "income-statement" ? <IncomeStatementView /> : null}
      {kind === "balance-sheet" ? <BalanceSheetView /> : null}
    </div>
  );
}

function TrialBalanceView() {
  const [data, setData] = useState<TrialBalance | null>(null);
  useEffect(() => {
    fetchTrialBalance().then(setData).catch(() => {});
  }, []);
  if (!data) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 text-[12px] text-muted border-b border-border">
        تراز آزمایشی — تا {formatJalaliDate(data.asOf)}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-start text-[11px] text-muted font-semibold py-2.5 px-4">حساب</th>
            <th className="text-start text-[11px] text-muted font-semibold py-2.5 px-3">بدهکار</th>
            <th className="text-start text-[11px] text-muted font-semibold py-2.5 px-3">بستانکار</th>
            <th className="text-start text-[11px] text-muted font-semibold py-2.5 px-4">مانده</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.accountId} className="border-b border-border last:border-b-0">
              <td className="py-2.5 px-4 text-[12.5px] font-bold">
                {r.name} <span className="text-muted font-normal">({r.code})</span>
              </td>
              <td className="py-2.5 px-3 text-[12px]">{r.debit ? formatToman(r.debit) : "—"}</td>
              <td className="py-2.5 px-3 text-[12px]">{r.credit ? formatToman(r.credit) : "—"}</td>
              <td className="py-2.5 px-4 text-[12.5px] font-bold">{formatToman(r.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td className="py-3 px-4 text-[12.5px] font-extrabold">جمع کل</td>
            <td className="py-3 px-3 text-[12.5px] font-extrabold">{formatToman(data.totalDebit)}</td>
            <td className="py-3 px-3 text-[12.5px] font-extrabold">{formatToman(data.totalCredit)}</td>
            <td className="py-3 px-4"></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

function IncomeStatementView() {
  const [data, setData] = useState<IncomeStatement | null>(null);
  useEffect(() => {
    fetchIncomeStatement().then(setData).catch(() => {});
  }, []);
  if (!data) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  return (
    <Card className="p-5">
      <div className="text-[12px] text-muted mb-4">
        از {formatJalaliDate(data.from)} تا {formatJalaliDate(data.to)}
      </div>
      <div className="text-[12px] font-bold text-success mb-2">درآمدها</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {data.revenueRows.map((r) => (
          <div key={r.accountId} className="flex justify-between text-[12.5px]">
            <span className="text-ink-soft">{r.name}</span>
            <span className="font-bold">{formatToman(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[13px] font-extrabold border-t border-border pt-1.5 mt-1">
          <span>جمع درآمد</span>
          <span>{formatToman(data.totalRevenue)}</span>
        </div>
      </div>
      <div className="text-[12px] font-bold text-danger mb-2">هزینه‌ها</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {data.expenseRows.map((r) => (
          <div key={r.accountId} className="flex justify-between text-[12.5px]">
            <span className="text-ink-soft">{r.name}</span>
            <span className="font-bold">{formatToman(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[13px] font-extrabold border-t border-border pt-1.5 mt-1">
          <span>جمع هزینه</span>
          <span>{formatToman(data.totalExpense)}</span>
        </div>
      </div>
      <div
        className={clsx(
          "flex justify-between text-[15px] font-extrabold rounded-xl px-4 py-3",
          data.netIncome >= 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
        )}
      >
        <span>سود (زیان) خالص</span>
        <span>{formatToman(data.netIncome)}</span>
      </div>
    </Card>
  );
}

function BalanceSheetView() {
  const [data, setData] = useState<BalanceSheet | null>(null);
  useEffect(() => {
    fetchBalanceSheet().then(setData).catch(() => {});
  }, []);
  if (!data) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  return (
    <Card className="p-5">
      <div className="text-[12px] text-muted mb-4">ترازنامه — تا {formatJalaliDate(data.asOf)}</div>

      <div className="text-[12px] font-bold text-primary mb-2">{ACCOUNT_TYPE_LABELS.ASSET}</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {data.assetRows.map((r) => (
          <div key={r.accountId} className="flex justify-between text-[12.5px]">
            <span className="text-ink-soft">{r.name}</span>
            <span className="font-bold">{formatToman(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[13px] font-extrabold border-t border-border pt-1.5 mt-1">
          <span>جمع دارایی‌ها</span>
          <span>{formatToman(data.totalAssets)}</span>
        </div>
      </div>

      <div className="text-[12px] font-bold text-warning mb-2">{ACCOUNT_TYPE_LABELS.LIABILITY}</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {data.liabilityRows.map((r) => (
          <div key={r.accountId} className="flex justify-between text-[12.5px]">
            <span className="text-ink-soft">{r.name}</span>
            <span className="font-bold">{formatToman(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[13px] font-extrabold border-t border-border pt-1.5 mt-1">
          <span>جمع بدهی‌ها</span>
          <span>{formatToman(data.totalLiabilities)}</span>
        </div>
      </div>

      <div className="text-[12px] font-bold text-ink-soft mb-2">{ACCOUNT_TYPE_LABELS.EQUITY}</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {data.equityRows.map((r) => (
          <div key={r.accountId} className="flex justify-between text-[12.5px]">
            <span className="text-ink-soft">{r.name}</span>
            <span className="font-bold">{formatToman(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[12.5px]">
          <span className="text-ink-soft">سود انباشته</span>
          <span className="font-bold">{formatToman(data.retainedEarnings)}</span>
        </div>
        <div className="flex justify-between text-[13px] font-extrabold border-t border-border pt-1.5 mt-1">
          <span>جمع حقوق صاحبان سهام</span>
          <span>{formatToman(data.totalEquity)}</span>
        </div>
      </div>

      <div
        className={clsx(
          "flex items-center justify-between text-[12.5px] font-bold rounded-xl px-4 py-2.5",
          data.balances ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
        )}
      >
        <span>دارایی‌ها = بدهی‌ها + حقوق صاحبان سهام</span>
        <span>{data.balances ? "✓ متوازن" : "✗ نامتوازن"}</span>
      </div>
    </Card>
  );
}
