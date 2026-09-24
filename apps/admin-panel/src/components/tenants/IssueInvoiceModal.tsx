import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createTenantInvoice, updateTenantInvoice, ApiError, type TenantInvoice } from "@/lib/api";

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
  invoice,
}: {
  tenantId: string;
  tenantName: string;
  suggestedAmount?: number;
  onClose: () => void;
  onIssued: () => void;
  /** ویرایش فاکتور موجود */
  invoice?: TenantInvoice;
}) {
  const [amount, setAmount] = useState(invoice?.amount ?? suggestedAmount ?? 0);
  const [dueAt, setDueAt] = useState(invoice ? invoice.dueAt.slice(0, 10) : defaultDueDate());
  const [lineName, setLineName] = useState(invoice?.items?.[0]?.moduleName ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const lines = lineName.trim() ? [{ name: lineName.trim(), amount }] : undefined;
      if (invoice) await updateTenantInvoice(tenantId, invoice.id, { amount, dueAt: new Date(dueAt).toISOString(), lines });
      else await createTenantInvoice(tenantId, { amount, dueAt: new Date(dueAt).toISOString(), lines });
      onIssued();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={invoice ? `ویرایش فاکتور «${tenantName}»` : `صدور فاکتور دستی برای «${tenantName}»`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <p className="text-[12px] text-muted">
          پیش‌فاکتور فقط یک رکورد در انتظار پرداخت ثبت می‌کند و تاریخ انقضای اشتراک را تغییر نمی‌دهد — برای
          تمدید واقعی از دکمه‌ی «تمدید اشتراک» استفاده کنید.
        </p>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">شرح فاکتور (اختیاری)</label>
          <input
            value={lineName}
            onChange={(e) => setLineName(e.target.value)}
            placeholder="مثلاً: هزینه‌ی راه‌اندازی و آموزش"
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>
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
          <JalaliDateInput value={dueAt} onChange={setDueAt} placeholder="انتخاب تاریخ" />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !dueAt}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ذخیره..." : invoice ? "ذخیره تغییرات" : "صدور فاکتور"}
        </button>
      </form>
    </Modal>
  );
}
