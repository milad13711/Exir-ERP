import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createAccount, type Account, type AccountType } from "@/lib/api";
import { ACCOUNT_TYPE_LABELS } from "./accounting-shared";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (account: Account) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("EXPENSE");
  const [isCashAccount, setIsCashAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const account = await createAccount({ code: code.trim(), name: name.trim(), type, isCashAccount });
      onCreated({ ...account, balance: 0 });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="حساب جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className={labelClass}>کد حساب</label>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="6010"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>نام حساب</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً هزینه تبلیغات"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>نوع حساب</label>
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className={inputClass}>
            {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={isCashAccount}
            onChange={(e) => setIsCashAccount(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-primary)]"
          />
          این حساب صندوق یا بانک است (در خزانه‌داری نمایش داده شود)
        </label>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !code.trim() || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن حساب"}
        </button>
      </form>
    </Modal>
  );
}
