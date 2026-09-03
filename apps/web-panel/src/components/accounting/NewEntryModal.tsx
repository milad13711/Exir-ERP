import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { PlusIcon, CloseIcon } from "@/components/icons";
import { formatToman, formatNumber } from "@/lib/persian";
import { createJournalEntry, type Account, type JournalEntry } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

type LineDraft = { accountId: string; side: "debit" | "credit"; amount: string; description: string };

function emptyLine(defaultAccountId: string): LineDraft {
  return { accountId: defaultAccountId, side: "debit", amount: "", description: "" };
}

export function NewEntryModal({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: Account[];
  onClose: () => void;
  onCreated: (entry: JournalEntry) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    emptyLine(accounts[0]?.id ?? ""),
    { ...emptyLine(accounts[1]?.id ?? accounts[0]?.id ?? ""), side: "credit" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalDebit = lines.reduce((s, l) => s + (l.side === "debit" ? Number(l.amount || 0) : 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.side === "credit" ? Number(l.amount || 0) : 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!balanced) return;
    setSubmitting(true);
    setError(null);
    try {
      const entry = await createJournalEntry({
        date,
        description: description.trim() || undefined,
        lines: lines
          .filter((l) => Number(l.amount) > 0)
          .map((l) => ({
            accountId: l.accountId,
            debit: l.side === "debit" ? Number(l.amount) : 0,
            credit: l.side === "credit" ? Number(l.amount) : 0,
            description: l.description.trim() || undefined,
          })),
      });
      onCreated(entry);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="سند حسابداری جدید" onClose={onClose} width="max-w-[600px]">
      {accounts.length < 2 ? (
        <div className="text-[13px] text-muted text-center py-6">ابتدا باید حداقل دو حساب داشته باشید.</div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>تاریخ سند</label>
              <JalaliDateInput value={date} onChange={setDate} />
            </div>
            <div>
              <label className={labelClass}>شرح سند</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثلاً دریافت وجه بابت فروش"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-semibold text-ink-soft">ردیف‌های سند</label>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, emptyLine(accounts[0]?.id ?? "")])}
                className="text-[11.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                ردیف جدید
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-50 border border-border rounded-xl p-2.5">
                  <select
                    value={line.accountId}
                    onChange={(e) => updateLine(i, { accountId: e.target.value })}
                    className="flex-[2] text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={line.side}
                    onChange={(e) => updateLine(i, { side: e.target.value as LineDraft["side"] })}
                    className="flex-1 text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                  >
                    <option value="debit">بدهکار</option>
                    <option value="credit">بستانکار</option>
                  </select>
                  <input
                    value={line.amount}
                    onChange={(e) => updateLine(i, { amount: e.target.value.replace(/[^0-9]/g, "") })}
                    placeholder="مبلغ"
                    dir="ltr"
                    inputMode="numeric"
                    className="flex-1 text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={lines.length <= 2}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-30 shrink-0"
                  >
                    <CloseIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-1 text-[12.5px]">
            <span className="text-muted">
              جمع بدهکار: <strong className="text-ink font-bold">{formatToman(totalDebit)}</strong>
            </span>
            <span className="text-muted">
              جمع بستانکار: <strong className="text-ink font-bold">{formatToman(totalCredit)}</strong>
            </span>
            {!balanced ? (
              <span className="text-danger font-bold">
                تراز نیست ({formatNumber(Math.abs(totalDebit - totalCredit))})
              </span>
            ) : (
              <span className="text-success font-bold">تراز است ✓</span>
            )}
          </div>

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}

          <button
            type="submit"
            disabled={submitting || !balanced}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ثبت..." : "ثبت سند (پیش‌نویس)"}
          </button>
        </form>
      )}
    </Modal>
  );
}
