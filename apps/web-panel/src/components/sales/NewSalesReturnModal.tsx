import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createSalesReturn, ApiError, type SalesInvoiceDetail } from "@/lib/api";

type DraftLine = { productId: string | null; description: string; maxQuantity: number; quantity: string; unitPrice: number };

export function NewSalesReturnModal({
  invoice,
  onClose,
  onCreated,
}: {
  invoice: SalesInvoiceDetail;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(
    invoice.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      maxQuantity: l.quantity,
      quantity: "0",
      unitPrice: l.unitPrice,
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateQuantity(i: number, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, quantity: value.replace(/[^0-9]/g, "") } : l)));
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * l.unitPrice, 0);
  const hasAnyLine = lines.some((l) => Number(l.quantity) > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validLines = lines.filter((l) => Number(l.quantity) > 0);
    if (validLines.length === 0) return;
    setSubmitting(true);
    try {
      await createSalesReturn({
        invoiceId: invoice.id,
        reason: reason.trim() || undefined,
        lines: validLines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice,
        })),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`ثبت مرجوعی برای فاکتور #${invoice.invoiceNo}`} onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">اقلام مرجوعی</label>
          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-50 border border-border rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold truncate">{line.description}</div>
                  <div className="text-[11px] text-muted mt-0.5">حداکثر قابل مرجوع: {line.maxQuantity}</div>
                </div>
                <input
                  value={line.quantity}
                  onChange={(e) => updateQuantity(i, e.target.value)}
                  dir="ltr"
                  className="w-16 text-[12.5px] bg-surface border border-border rounded-lg px-2 py-2 outline-none text-center"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">دلیل مرجوعی (اختیاری)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>

        <div className="flex items-center justify-between bg-slate-50 border border-border rounded-xl p-3.5">
          <div className="text-[12px] text-muted">مبلغ قابل بازگشت به مشتری</div>
          <div className="text-[15px] font-extrabold">{total.toLocaleString("en-US")} تومان</div>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting || !hasAnyLine}
          className="w-full py-2.5 rounded-xl bg-danger text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت مرجوعی — بازگشت به انبار و اصلاح سند حسابداری"}
        </button>
      </form>
    </Modal>
  );
}
