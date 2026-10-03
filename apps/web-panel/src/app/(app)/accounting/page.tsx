"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { AccountingIcon, PlusIcon, WarningIcon } from "@/components/icons";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  fetchAccounts,
  fetchJournalEntries,
  fetchAccountingSummary,
  type Account,
  type JournalEntry,
  type AccountingSummary,
} from "@/lib/api";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_TONES,
  ENTRY_STATUS_LABELS,
  ENTRY_STATUS_TONES,
} from "@/components/accounting/accounting-shared";
import { NewEntryModal } from "@/components/accounting/NewEntryModal";
import { EntryDetailModal } from "@/components/accounting/EntryDetailModal";
import { NewAccountModal } from "@/components/accounting/NewAccountModal";
import { LedgerModal } from "@/components/accounting/LedgerModal";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";
import { ReportsTab } from "@/components/accounting/ReportsTab";
import { ReconciliationTab } from "@/components/accounting/ReconciliationTab";
import { PartiesLedgerTab } from "@/components/accounting/PartiesLedgerTab";
import { BudgetsTab } from "@/components/accounting/BudgetsTab";
import { FixedAssetsTab } from "@/components/accounting/FixedAssetsTab";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
type Tab = "entries" | "accounts" | "reports" | "reconciliation" | "budgets" | "fixedAssets" | "parties";

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("entries");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [summary, setSummary] = useState<AccountingSummary | null>(null);

  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [newAccountOpen, setNewAccountOpen] = useState(false);

  function reloadSummary() {
    fetchAccountingSummary().then(setSummary).catch(() => {});
  }

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
    fetchJournalEntries().then(setEntries).catch(() => setEntries([]));
    reloadSummary();
  }, []);

  const cashAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isCashAccount), [accounts]);

  function upsertEntry(entry: JournalEntry) {
    setEntries((prev) => {
      if (!prev) return [entry];
      const exists = prev.some((e) => e.id === entry.id);
      return exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...prev];
    });
    reloadSummary();
    fetchAccounts().then(setAccounts).catch(() => {});
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">حسابداری مالی</h1>
            <ModuleHelp code="accounting" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">اسناد حسابداری، دفتر کل و خزانه‌داری</p>
        </div>
        {tab === "entries" || tab === "accounts" ? (
          <button
            onClick={() => (tab === "entries" ? setNewEntryOpen(true) : setNewAccountOpen(true))}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer shrink-0"
          >
            <PlusIcon className="w-4 h-4" />
            {tab === "entries" ? "سند جدید" : "حساب جدید"}
          </button>
        ) : null}
      </div>

      {summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <KpiCard label="موجودی نقد و بانک" value={summary.cashBalance} unitSuffix="تومان" tone="primary" icon={<AccountingIcon />} />
          <KpiCard label="درآمد این ماه" value={summary.monthRevenue} unitSuffix="تومان" tone="success" icon={<AccountingIcon />} />
          <KpiCard label="هزینه این ماه" value={summary.monthExpense} unitSuffix="تومان" tone="danger" icon={<AccountingIcon />} />
          <KpiCard
            label="اسناد پیش‌نویس"
            value={summary.draftCount}
            unitSuffix="سند"
            tone="warning"
            icon={<WarningIcon />}
            note={summary.draftCount > 0 ? "نیازمند بررسی و ثبت قطعی" : undefined}
          />
        </div>
      ) : null}

      {cashAccounts.length > 0 ? (
        <div className="flex items-center gap-2.5 mt-5 flex-wrap">
          <span className="text-[12px] text-muted">خزانه‌داری:</span>
          {cashAccounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenAccountId(a.id)}
              className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3.5 py-2 cursor-pointer hover:border-primary transition-colors"
            >
              <span className="text-[12px] font-bold">{a.name}</span>
              <span className="text-[12px] text-primary font-bold">{formatToman(a.balance)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 mt-7 border-b border-border overflow-x-auto">
        {(
          [
            ["entries", "اسناد حسابداری"],
            ["accounts", "کدینگ حساب‌ها"],
            ["parties", "بدهکاران و بستانکاران"],
            ["reconciliation", "مغایرت‌گیری بانکی"],
            ["budgets", "بودجه‌بندی"],
            ["fixedAssets", "دارایی‌های ثابت"],
            ["reports", "گزارش‌های مالی"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors shrink-0 whitespace-nowrap",
              tab === key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink-soft",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "reports" ? (
        <ReportsTab />
      ) : tab === "parties" ? (
        <PartiesLedgerTab />
      ) : tab === "reconciliation" ? (
        <ReconciliationTab />
      ) : tab === "budgets" ? (
        <BudgetsTab />
      ) : tab === "fixedAssets" ? (
        <FixedAssetsTab />
      ) : tab === "entries" ? (
        <Card className="mt-5 p-2">
          {entries === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز سندی ثبت نشده است</div>
          ) : (
            entries.map((entry, i) => {
              const total = entry.lines.reduce((s, l) => s + l.debit, 0);
              return (
                <button
                  key={entry.id}
                  onClick={() => setOpenEntryId(entry.id)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                    i < entries.length - 1 && "border-b border-border",
                  )}
                >
                  <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 text-[12px] font-extrabold">
                    {toPersianDigits(entry.number)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate">{entry.description ?? "بدون شرح"}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDate(entry.date)}</div>
                  </div>
                  <div className="text-[13px] font-extrabold">{formatToman(total)}</div>
                  <Badge tone={ENTRY_STATUS_TONES[entry.status]}>{ENTRY_STATUS_LABELS[entry.status]}</Badge>
                </button>
              );
            })
          )}
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-end mt-5">
            <ExcelImportExportBar
              exportPath="/accounting/accounts/export"
              exportFilename="accounts.xlsx"
              importPath="/accounting/accounts/import"
              templatePath="/accounting/accounts/template"
              templateFilename="accounts-template.xlsx"
              onImported={() => fetchAccounts().then(setAccounts).catch(() => {})}
            />
          </div>
        <Card className="mt-3 p-2">
          {accounts === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            accounts.map((a, i) => (
              <button
                key={a.id}
                onClick={() => setOpenAccountId(a.id)}
                className={clsx(
                  "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                  i < accounts.length - 1 && "border-b border-border",
                )}
              >
                <div className="w-9 h-9 rounded-xl bg-slate-100 text-ink-soft flex items-center justify-center shrink-0 text-[11px] font-extrabold">
                  {toPersianDigits(a.code)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate">{a.name}</div>
                  <div className="mt-1 sm:hidden">
                    <Badge tone={ACCOUNT_TYPE_TONES[a.type]}>{ACCOUNT_TYPE_LABELS[a.type]}</Badge>
                  </div>
                </div>
                <div className="hidden sm:block shrink-0">
                  <Badge tone={ACCOUNT_TYPE_TONES[a.type]}>{ACCOUNT_TYPE_LABELS[a.type]}</Badge>
                </div>
                <div className="text-[13px] font-extrabold w-[110px] sm:w-[140px] text-left shrink-0">
                  {formatToman(a.balance)}
                </div>
              </button>
            ))
          )}
        </Card>
        </>
      )}

      {newEntryOpen ? (
        <NewEntryModal accounts={accounts ?? []} onClose={() => setNewEntryOpen(false)} onCreated={upsertEntry} />
      ) : null}

      {openEntryId ? (
        <EntryDetailModal entryId={openEntryId} onClose={() => setOpenEntryId(null)} onChanged={upsertEntry} />
      ) : null}

      {newAccountOpen ? (
        <NewAccountModal
          onClose={() => setNewAccountOpen(false)}
          onCreated={(account) => setAccounts((prev) => [...(prev ?? []), account])}
        />
      ) : null}

      {openAccountId ? (
        <LedgerModal
          accountId={openAccountId}
          onClose={() => setOpenAccountId(null)}
          onUpdated={(updated) =>
            setAccounts((prev) => (prev ?? []).map((a) => (a.id === updated.id ? { ...a, ...updated } : a)))
          }
          onDeleted={(id) => setAccounts((prev) => (prev ?? []).filter((a) => a.id !== id))}
        />
      ) : null}
    </div>
  );
}
