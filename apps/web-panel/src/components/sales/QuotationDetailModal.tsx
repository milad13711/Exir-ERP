import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchSalesQuotation,
  sendSalesQuotation,
  acceptSalesQuotation,
  rejectSalesQuotation,
  convertSalesQuotation,
  deleteSalesQuotation,
  ApiError,
  type SalesQuotationDetail,
  type SalesQuotationStatus,
} from "@/lib/api";

const STATUS_LABELS: Record<SalesQuotationStatus, string> = {
  DRAFT: "پیش‌نویس",
  SENT: "ارسال‌شده",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  EXPIRED: "منقضی‌شده",
  CONVERTED: "تبدیل‌شده به فاکتور",
};

const STATUS_TONES: Record<SalesQuotationStatus, "neutral" | "warning" | "success" | "danger" | "primary"> = {
  DRAFT: "neutral",
  SENT: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "danger",
  CONVERTED: "primary",
};

export function QuotationDetailModal({
  quotationId,
  onClose,
  onChanged,
  onConverted,
}: {
  quotationId: string;
  onClose: () => void;
  onChanged: () => void;
  onConverted: (invoiceId: string) => void;
}) {
  const [quotation, setQuotation] = useState<SalesQuotationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchSalesQuotation(quotationId).then(setQuotation);
  }
  useEffect(reload, [quotationId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleConvert() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await convertSalesQuotation(quotationId);
      onChanged();
      onConverted(invoice.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("این پیش‌فاکتور حذف شود؟")) return;
    setBusy(true);
    try {
      await deleteSalesQuotation(quotationId);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="پیش‌فاکتور" onClose={onClose} width="max-w-[600px]">
      {!quotation ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-extrabold">پیش‌فاکتور #{quotation.quotationNo}</div>
              <div className="text-[12.5px] text-ink-soft mt-1">
                {quotation.contact.company || quotation.contact.name}
              </div>
              <div className="text-[11.5px] text-muted mt-0.5">
                صادر شده: {formatJalaliDate(quotation.issuedAt)}
                {quotation.validUntil ? ` · اعتبار تا ${formatJalaliDate(quotation.validUntil)}` : ""}
              </div>
            </div>
            <Badge tone={STATUS_TONES[quotation.status]}>{STATUS_LABELS[quotation.status]}</Badge>
          </div>

          <div className="flex flex-col gap-2">
            {quotation.lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold truncate">{l.description}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {l.quantity} × {formatToman(l.unitPrice)}
                  </div>
                </div>
                <div className="text-[12.5px] font-extrabold shrink-0">{formatToman(l.lineTotal)}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between bg-slate-50 border border-border rounded-xl p-3.5">
            <div className="text-[12px] text-muted">
              جمع اقلام: {formatToman(quotation.subtotal)}
              {quotation.discount > 0 ? ` · تخفیف: ${formatToman(quotation.discount)}` : ""}
            </div>
            <div className="text-[15px] font-extrabold">{formatToman(quotation.total)}</div>
          </div>

          {quotation.notes ? (
            <div className="text-[12.5px] text-ink-soft bg-slate-50 border border-border rounded-xl p-3.5">
              {quotation.notes}
            </div>
          ) : null}

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}

          <div className="flex items-center flex-wrap gap-2">
            {quotation.status === "DRAFT" ? (
              <>
                <button
                  onClick={() => run(() => sendSalesQuotation(quotationId))}
                  disabled={busy}
                  className="text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  ارسال به مشتری
                </button>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="text-[12.5px] font-bold text-danger bg-danger-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  حذف
                </button>
              </>
            ) : null}

            {quotation.status === "SENT" ? (
              <>
                <button
                  onClick={() => run(() => acceptSalesQuotation(quotationId))}
                  disabled={busy}
                  className="text-[12.5px] font-bold text-white bg-success px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  پذیرفته شد
                </button>
                <button
                  onClick={() => run(() => rejectSalesQuotation(quotationId))}
                  disabled={busy}
                  className="text-[12.5px] font-bold text-danger bg-danger-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  رد شد
                </button>
              </>
            ) : null}

            {quotation.status === "SENT" || quotation.status === "ACCEPTED" ? (
              <button
                onClick={handleConvert}
                disabled={busy}
                className="text-[12.5px] font-bold text-white bg-accent px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
              >
                تبدیل به فاکتور فروش
              </button>
            ) : null}

            {quotation.status === "CONVERTED" && quotation.convertedInvoiceId ? (
              <button
                onClick={() => onConverted(quotation.convertedInvoiceId!)}
                className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl cursor-pointer"
              >
                مشاهده فاکتور
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
