import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { TrashIcon, PlusIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchAccounts,
  fetchBudgets,
  fetchBudget,
  createBudget,
  deleteBudget,
  type Account,
  type Budget,
  type BudgetDetail,
} from "@/lib/api";

type DraftLine = { accountId: string; amount: string };

export function BudgetsTab() {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ accountId: "", amount: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    fetchBudgets().then(setBudgets).catch(() => setBudgets([]));
  }
  useEffect(reload, []);
  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (!openId) return;
    fetchBudget(openId).then(setDetail).catch(() => setDetail(null));
  }, [openId]);

  function closeDetail() {
    setOpenId(null);
    setDetail(null);
  }

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const validLines = lines.filter((l) => l.accountId && Number(l.amount) >= 0);
    if (!name.trim() || !periodStart || !periodEnd || validLines.length === 0) return;
    setSubmitting(true);
    try {
      const budget = await createBudget({
        name: name.trim(),
        periodStart,
        periodEnd,
        lines: validLines.map((l) => ({ accountId: l.accountId, amount: Number(l.amount) || 0 })),
      });
      setName("");
      setPeriodStart("");
      setPeriodEnd("");
      setLines([{ accountId: "", amount: "" }]);
      setCreating(false);
      reload();
      setOpenId(budget.id);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این بودجه حذف شود؟")) return;
    setDeletingId(id);
    try {
      await deleteBudget(id);
      if (openId === id) closeDetail();
      reload();
    } finally {
      setDeletingId(null);
    }
  }

  if (openId && detail) {
    const totalBudget = detail.lines.reduce((s, l) => s + l.amount, 0);
    const totalActual = detail.lines.reduce((s, l) => s + l.actual, 0);
    return (
      <div className="mt-5 flex flex-col gap-4">
        <button onClick={closeDetail} className="text-[12px] font-bold text-primary cursor-pointer self-start">
          ← بازگشت به فهرست بودجه‌ها
        </button>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-extrabold">{detail.name}</div>
              <div className="text-[12px] text-muted mt-1">
                {formatJalaliDate(detail.periodStart)} تا {formatJalaliDate(detail.periodEnd)}
              </div>
            </div>
            <div className="text-left">
              <div className="text-[11px] text-muted">جمع بودجه / واقعی</div>
              <div className="text-[13px] font-bold mt-0.5">
                {formatToman(totalBudget)} / {formatToman(totalActual)}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-2">
          {detail.lines.map((l, i) => {
            const pct = l.amount > 0 ? Math.round((l.actual / l.amount) * 100) : l.actual > 0 ? 100 : 0;
            const over = l.variance < 0;
            return (
              <div key={l.id} className={`px-4 py-3.5 ${i < detail.lines.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[12.5px] font-bold">
                    {l.account.name} <span className="text-muted font-normal" dir="ltr">({l.account.code})</span>
                  </span>
                  <Badge tone={over ? "danger" : "success"}>{over ? "بیش از بودجه" : "در محدوده"}</Badge>
                </div>
                <div className="flex items-center gap-3 text-[11.5px] text-muted">
                  <span>بودجه: {formatToman(l.amount)}</span>
                  <span>واقعی: {formatToman(l.actual)}</span>
                  <span className={over ? "text-danger font-bold" : "text-success font-bold"}>
                    مابه‌التفاوت: {formatToman(l.variance)}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${over ? "bg-danger" : "bg-success"}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          بودجه جدید
        </button>
      </div>

      {creating ? (
        <Card className="p-4">
          <form onSubmit={handleCreate} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11.5px] text-muted mb-1 block">نام بودجه</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
                  placeholder="مثلاً بودجه‌ی سال ۱۴۰۵"
                />
              </div>
              <div>
                <label className="text-[11.5px] text-muted mb-1 block">از تاریخ</label>
                <JalaliDateInput value={periodStart} onChange={setPeriodStart} />
              </div>
              <div>
                <label className="text-[11.5px] text-muted mb-1 block">تا تاریخ</label>
                <JalaliDateInput value={periodEnd} onChange={setPeriodEnd} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={l.accountId}
                    onChange={(e) => updateLine(i, { accountId: e.target.value })}
                    className="flex-1 text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                  >
                    <option value="">انتخاب حساب...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.code})
                      </option>
                    ))}
                  </select>
                  <input
                    value={l.amount}
                    onChange={(e) => updateLine(i, { amount: e.target.value.replace(/[^0-9]/g, "") })}
                    placeholder="مبلغ بودجه (تومان)"
                    dir="ltr"
                    className="w-40 text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={lines.length === 1}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-danger hover:bg-danger-soft cursor-pointer disabled:opacity-30 shrink-0"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, { accountId: "", amount: "" }])}
                className="flex items-center gap-1 text-[12px] font-bold text-primary cursor-pointer self-start"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                افزودن ردیف
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting || !name.trim() || !periodStart || !periodEnd}
              className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? "در حال ثبت..." : "ثبت بودجه"}
            </button>
          </form>
        </Card>
      ) : null}

      <Card className="p-2">
        {budgets === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : budgets.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز بودجه‌ای ثبت نشده است</div>
        ) : (
          budgets.map((b, i) => (
            <div
              key={b.id}
              className={`flex items-center gap-3 px-4 py-3.5 ${i < budgets.length - 1 ? "border-b border-border" : ""}`}
            >
              <button onClick={() => setOpenId(b.id)} className="flex-1 min-w-0 text-right cursor-pointer">
                <div className="text-[13px] font-bold">{b.name}</div>
                <div className="text-[11.5px] text-muted mt-1">
                  {formatJalaliDate(b.periodStart)} تا {formatJalaliDate(b.periodEnd)}
                </div>
              </button>
              <button
                onClick={() => handleDelete(b.id)}
                disabled={deletingId === b.id}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-danger hover:bg-danger-soft cursor-pointer disabled:opacity-50 shrink-0"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
