import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createAccount, updateAccount, type Account, type AccountType } from "@/lib/api";
import { ACCOUNT_TYPE_LABELS } from "./accounting-shared";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewAccountModal({
  onClose,
  onCreated,
  account: editing,
  onUpdated,
  hasMovements,
}: {
  onClose: () => void;
  onCreated?: (account: Account) => void;
  /** ویرایش حساب موجود؛ اگر پر باشد، فرم به‌جای ایجاد، ویرایش می‌کند */
  account?: Account;
  onUpdated?: (account: Account) => void;
  /** حساب دارای گردش: تغییر نوع حساب مجاز نیست (سرور هم رد می‌کند) */
  hasMovements?: boolean;
}) {
  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<AccountType>(editing?.type ?? "EXPENSE");
  const [isCashAccount, setIsCashAccount] = useState(editing?.isCashAccount ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeLocked = Boolean(editing?.isSystem);
  const typeLocked = Boolean(editing && (editing.isSystem || hasMovements));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editing) {
        const account = await updateAccount(editing.id, {
          ...(codeLocked ? {} : { code: code.trim() }),
          name: name.trim(),
          ...(typeLocked ? {} : { type }),
          isCashAccount,
        });
        onUpdated?.({ ...account, balance: editing.balance });
      } else {
        const account = await createAccount({ code: code.trim(), name: name.trim(), type, isCashAccount });
        onCreated?.({ ...account, balance: 0 });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={editing ? "ویرایش حساب" : "حساب جدید"} onClose={onClose}>
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
              disabled={codeLocked}
            />
            {codeLocked ? <p className="text-[11px] text-muted mt-1">کد حساب‌های پیش‌فرض سیستم قابل تغییر نیست</p> : null}
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
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className={inputClass} disabled={typeLocked}>
            {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {typeLocked ? <p className="text-[11px] text-muted mt-1">نوع حسابی که گردش دارد (یا پیش‌فرض سیستم است) قابل تغییر نیست</p> : null}
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
          {submitting ? "در حال ثبت..." : editing ? "ذخیره تغییرات" : "افزودن حساب"}
        </button>
      </form>
    </Modal>
  );
}
