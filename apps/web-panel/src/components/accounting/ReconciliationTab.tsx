import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchAccounts,
  fetchReconciliation,
  addStatementLines,
  deleteStatementLine,
  matchStatementLine,
  unmatchStatementLine,
  autoMatchReconciliation,
  type Account,
  type ReconciliationOverview,
} from "@/lib/api";

export function ReconciliationTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [overview, setOverview] = useState<ReconciliationOverview | null>(null);
  const [selectedStatementLine, setSelectedStatementLine] = useState<string | null>(null);
  const [autoMatching, setAutoMatching] = useState(false);

  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchAccounts().then((list) => {
      const cashAccounts = list.filter((a) => a.isCashAccount);
      setAccounts(cashAccounts);
      setAccountId((prev) => prev || cashAccounts[0]?.id || "");
    });
  }, []);

  function reload() {
    if (!accountId) return;
    fetchReconciliation(accountId).then(setOverview).catch(() => setOverview(null));
  }
  useEffect(reload, [accountId]);

  async function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !description.trim() || !Number(amount)) return;
    setSubmitting(true);
    try {
      await addStatementLines(accountId, [
        { date, description: description.trim(), amount: Number(amount), reference: reference.trim() || undefined },
      ]);
      setDate("");
      setDescription("");
      setAmount("");
      setReference("");
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAutoMatch() {
    setAutoMatching(true);
    try {
      await autoMatchReconciliation(accountId);
      reload();
    } finally {
      setAutoMatching(false);
    }
  }

  async function handleMatch(journalLineId: string) {
    if (!selectedStatementLine) return;
    await matchStatementLine(selectedStatementLine, journalLineId);
    setSelectedStatementLine(null);
    reload();
  }

  async function handleUnmatch(statementLineId: string) {
    await unmatchStatementLine(statementLineId);
    reload();
  }

  async function handleDeleteLine(id: string) {
    await deleteStatementLine(id);
    reload();
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[12px] text-muted">حساب:</span>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleAutoMatch}
          disabled={autoMatching || !accountId}
          className="text-[12px] font-bold text-accent bg-accent-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {autoMatching ? "در حال تطبیق..." : "تطبیق خودکار (بر اساس مبلغ یکسان)"}
        </button>
      </div>

      {overview ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3.5">
            <div className="text-[11px] text-muted">مانده‌ی دفتر</div>
            <div className="text-[14px] font-extrabold mt-0.5">{formatToman(overview.bookBalance)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-muted">مانده‌ی صورت‌حساب</div>
            <div className="text-[14px] font-extrabold mt-0.5">{formatToman(overview.statementBalance)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-muted">تطبیق‌شده</div>
            <div className="text-[14px] font-extrabold mt-0.5 text-success">{formatToman(overview.reconciledBalance)}</div>
          </Card>
          <Card className={`p-3.5 ${overview.difference !== 0 ? "border-warning" : ""}`}>
            <div className="text-[11px] text-muted">مابه‌التفاوت</div>
            <div className={`text-[14px] font-extrabold mt-0.5 ${overview.difference !== 0 ? "text-warning" : "text-success"}`}>
              {formatToman(overview.difference)}
            </div>
          </Card>
        </div>
      ) : null}

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-3">افزودن ردیف صورت‌حساب بانکی</div>
        <form onSubmit={handleAddLine} className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-[11.5px] text-muted mb-1 block">تاریخ</label>
            <JalaliDateInput value={date} onChange={setDate} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11.5px] text-muted mb-1 block">شرح</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
              placeholder="مثلاً واریز مشتری"
            />
          </div>
          <div>
            <label className="text-[11.5px] text-muted mb-1 block">مبلغ (واریز مثبت، برداشت منفی)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/(?!^-)[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
              placeholder="۰"
            />
          </div>
          <div className="flex items-end gap-2">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="flex-1 text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
              placeholder="شماره سند (اختیاری)"
            />
            <button
              type="submit"
              disabled={submitting || !date || !description.trim() || !Number(amount)}
              className="text-[12px] font-bold text-white bg-primary px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
            >
              افزودن
            </button>
          </div>
        </form>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-[13px] font-bold mb-3">
            صورت‌حساب بانکی — تطبیق‌نشده
            {selectedStatementLine ? (
              <span className="text-[11px] font-normal text-accent mr-2">یک ردیف دفتر را از سمت راست انتخاب کنید...</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
            {overview?.unreconciledStatementLines.length === 0 ? (
              <div className="text-[12px] text-muted text-center py-6">همه چیز تطبیق شده است</div>
            ) : (
              overview?.unreconciledStatementLines.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedStatementLine(l.id)}
                  className={`text-right border rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                    selectedStatementLine === l.id ? "border-accent bg-accent-soft" : "border-border bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-soft truncate">{l.description}</span>
                    <span className={`text-[12.5px] font-bold shrink-0 ${l.amount >= 0 ? "text-success" : "text-danger"}`} dir="ltr">
                      {l.amount.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10.5px] text-muted">{formatJalaliDate(l.date)}</span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteLine(l.id);
                      }}
                      className="text-[10.5px] text-danger cursor-pointer"
                    >
                      حذف
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-[13px] font-bold mb-3">دفتر حسابداری — تطبیق‌نشده</div>
          <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
            {overview?.unreconciledJournalLines.length === 0 ? (
              <div className="text-[12px] text-muted text-center py-6">همه چیز تطبیق شده است</div>
            ) : (
              overview?.unreconciledJournalLines.map((l) => (
                <button
                  key={l.id}
                  onClick={() => handleMatch(l.id)}
                  disabled={!selectedStatementLine}
                  className="text-right border border-border bg-slate-50 rounded-lg px-3 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:border-accent transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-soft truncate">{l.description ?? "بدون شرح"}</span>
                    <span className={`text-[12.5px] font-bold shrink-0 ${l.amount >= 0 ? "text-success" : "text-danger"}`} dir="ltr">
                      {l.amount.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-muted mt-1">
                    سند #{l.entryNumber} · {formatJalaliDate(l.date)}
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>

      {overview && overview.reconciledStatementLines.length > 0 ? (
        <Card className="p-4">
          <div className="text-[13px] font-bold mb-3">تطبیق‌شده‌ها</div>
          <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
            {overview.reconciledStatementLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[12px]">
                <span className="text-ink-soft truncate">{l.description}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted">{formatJalaliDate(l.date)}</span>
                  <span className="font-bold" dir="ltr">
                    {l.amount.toLocaleString("en-US")}
                  </span>
                  <span role="button" onClick={() => handleUnmatch(l.id)} className="text-accent cursor-pointer">
                    لغو تطبیق
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
