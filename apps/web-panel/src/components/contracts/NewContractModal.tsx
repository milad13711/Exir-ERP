import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { createContract, fetchCrmContacts, type ContractType, type CrmContact } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewContractModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ContractType>("SALES");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewalReminderDays, setRenewalReminderDays] = useState("30");
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !contactId || !value || !startDate || !endDate) return;
    setSaving(true);
    setError(null);
    try {
      await createContract({
        title: title.trim(),
        type,
        contactId,
        value: Number(value),
        startDate,
        endDate,
        autoRenew,
        renewalReminderDays: Number(renewalReminderDays) || 30,
        terms: terms.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت قرارداد ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="قرارداد جدید" onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>عنوان قرارداد</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setType("SALES")}
            className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === "SALES" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
          >
            فروش (با مشتری)
          </button>
          <button
            type="button"
            onClick={() => setType("PURCHASE")}
            className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === "PURCHASE" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
          >
            خرید (با تأمین‌کننده)
          </button>
        </div>

        <div>
          <label className={labelClass}>طرف قرارداد</label>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
            <option value="">انتخاب کنید</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>ارزش قرارداد (تومان)</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={inputClass}
          />
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>تاریخ شروع</label>
            <JalaliDateInput value={startDate} onChange={setStartDate} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>تاریخ پایان</label>
            <JalaliDateInput value={endDate} onChange={setEndDate} className={inputClass} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-lg px-3 py-2.5">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft cursor-pointer">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
            تمدید خودکار
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-muted">یادآوری (روز قبل از پایان)</span>
            <input
              value={renewalReminderDays}
              onChange={(e) => setRenewalReminderDays(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="w-14 text-center text-[12.5px] outline-none bg-white border border-border rounded-lg px-2 py-1.5"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>شرح بندها و شرایط (اختیاری)</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputClass} />
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button
          type="submit"
          disabled={saving || !title.trim() || !contactId || !value || !startDate || !endDate}
          className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? "در حال ثبت..." : "ثبت قرارداد"}
        </button>
      </form>
    </Modal>
  );
}
