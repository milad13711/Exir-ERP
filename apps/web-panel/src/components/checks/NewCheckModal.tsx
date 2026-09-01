import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { fetchCrmContacts, fetchSuppliers, createCheck, ApiError, type CrmContact, type Supplier, type Check, type CheckDirection } from "@/lib/api";

export function NewCheckModal({ onClose, onCreated }: { onClose: () => void; onCreated: (check: Check) => void }) {
  const [direction, setDirection] = useState<CheckDirection>("RECEIVED");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [partyId, setPartyId] = useState("");
  const [sayadId, setSayadId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [bankName, setBankName] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
    fetchSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId || !sayadId.trim() || !Number(amount) || !dueDate) return;
    setBusy(true);
    setError(null);
    try {
      const check = await createCheck({
        direction,
        sayadId: sayadId.trim(),
        amount: Number(amount),
        dueDate,
        bankName: bankName.trim() || undefined,
        contactId: direction === "RECEIVED" ? partyId : undefined,
        supplierId: direction === "ISSUED" ? partyId : undefined,
        reminderDaysBefore: Number(reminderDaysBefore) || 0,
      });
      onCreated(check);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="ثبت چک جدید" onClose={onClose} width="max-w-[480px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDirection("RECEIVED");
              setPartyId("");
            }}
            className={`flex-1 py-2.5 rounded-xl text-[12.5px] font-bold cursor-pointer ${
              direction === "RECEIVED" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
            }`}
          >
            دریافتی از مشتری
          </button>
          <button
            type="button"
            onClick={() => {
              setDirection("ISSUED");
              setPartyId("");
            }}
            className={`flex-1 py-2.5 rounded-xl text-[12.5px] font-bold cursor-pointer ${
              direction === "ISSUED" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
            }`}
          >
            صادرشده به تأمین‌کننده
          </button>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">
            {direction === "RECEIVED" ? "مشتری" : "تأمین‌کننده"}
          </label>
          <select
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            required
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          >
            <option value="">انتخاب کنید...</option>
            {(direction === "RECEIVED" ? contacts : suppliers).map((p) => (
              <option key={p.id} value={p.id}>
                {p.company || p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">شماره صیادی</label>
            <input
              value={sayadId}
              onChange={(e) => setSayadId(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">مبلغ (تومان)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تاریخ سررسید</label>
            <JalaliDateInput value={dueDate} onChange={setDueDate} />
          </div>
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">بانک (اختیاری)</label>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">یادآوری چند روز قبل از سررسید</label>
          <input
            value={reminderDaysBefore}
            onChange={(e) => setReminderDaysBefore(e.target.value.replace(/[^0-9]/g, ""))}
            dir="ltr"
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={busy || !partyId || !sayadId.trim() || !Number(amount) || !dueDate}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {busy ? "در حال ثبت..." : "ثبت چک"}
        </button>
      </form>
    </Modal>
  );
}
