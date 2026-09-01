import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createTenantInvoice, ApiError } from "@/lib/api";

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function IssueInvoiceModal({
  tenantId,
  tenantName,
  suggestedAmount,
  onClose,
  onIssued,
}: {
  tenantId: string;
  tenantName: string;
  suggestedAmount?: number;
  onClose: () => void;
  onIssued: () => void;
}) {
  const [amount, setAmount] = useState(suggestedAmount ?? 0);
  const [dueAt, setDueAt] = useState(defaultDueDate());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createTenantInvoice(tenantId, { amount, dueAt: new Date(dueAt).toISOString() });
      onIssued();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`صدور پیش‌فاکتور برای «${tenantName}»`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <p className="text-[12px] text-muted">
          پیش‌فاکتور فقط یک رکورد در انتظار پرداخت ثبت می‌کند و تاریخ انقضای اشتراک را تغییر نمی‌دهد — برای
          تمدید واقعی از دکمه‌ی «تمدید اشتراک» استفاده کنید.
        </p>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">مبلغ (تومان)</label>
          <input
            type="number"
            min={1}
            required
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">مهلت پرداخت</label>
          <input
            type="date"
            required
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال صدور..." : "صدور پیش‌فاکتور"}
        </button>
      </form>
    </Modal>
  );
}
