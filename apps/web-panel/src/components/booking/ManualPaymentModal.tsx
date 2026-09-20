import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { recordManualAppointmentPayment, ApiError, type Appointment } from "@/lib/api";
import { formatToman } from "@/lib/persian";

const METHODS = [
  { value: "CASH", label: "نقد" },
  { value: "CARD", label: "کارت‌خوان" },
  { value: "TRANSFER", label: "کارت‌به‌کارت / انتقال" },
] as const;

/** ثبت دستی پرداخت (بیعانه یا کل مبلغ) روی نوبت؛ بعد از ثبت نوبت تأیید و پیام جزئیات برای مشتری ارسال می‌شود. */
export function ManualPaymentModal({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const suggested = appointment.depositAmount ?? appointment.serviceType.price;
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("CASH");
  const [amount, setAmount] = useState(String(suggested || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recordManualAppointmentPayment(appointment.id, { method, amount: Number(amount) || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت پرداخت ناموفق بود");
      setBusy(false);
    }
  }

  return (
    <Modal title={`ثبت پرداخت — ${appointment.customerName}`} onClose={onClose} width="max-w-[420px]">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="text-[12px] text-muted">
          خدمت: {appointment.serviceType.name} · مبلغ خدمت {formatToman(appointment.serviceType.price)}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">روش پرداخت</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="text-[13px] bg-slate-50 border border-border rounded-lg px-3 py-2.5 outline-none">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">مبلغ دریافتی (تومان)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1} dir="ltr" className="text-[13px] bg-slate-50 border border-border rounded-lg px-3 py-2.5 outline-none" />
        </label>
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
        <button disabled={busy || !Number(amount)} className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">
          {busy ? "در حال ثبت..." : "ثبت پرداخت و ارسال تأیید به مشتری"}
        </button>
      </form>
    </Modal>
  );
}
