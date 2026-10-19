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
  cancelSalesQuotation,
  fetchSalesQuotationRevisions,
  ApiError,
  type SalesQuotationDetail,
  type SalesQuotationStatus,
} from "@/lib/api";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { TasksSection } from "@/components/shared/TasksSection";
import { useWorkspace } from "@/lib/workspace-context";
import { useModuleCan } from "@/hooks/useModuleCan";
import { ReasonDialog } from "@/components/ui/ReasonDialog";
import { RevisionHistory } from "@/components/shared/RevisionHistory";
import { NewQuotationModal } from "./NewQuotationModal";

const STATUS_LABELS: Record<SalesQuotationStatus, string> = {
  DRAFT: "پیش‌نویس",
  SENT: "ارسال‌شده",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  EXPIRED: "منقضی‌شده",
  CONVERTED: "تبدیل‌شده به فاکتور",
  CANCELLED: "باطل‌شده",
};

const STATUS_TONES: Record<SalesQuotationStatus, "neutral" | "warning" | "success" | "danger" | "primary"> = {
  DRAFT: "neutral",
  SENT: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "danger",
  CONVERTED: "primary",
  CANCELLED: "danger",
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
  const { me } = useWorkspace();
  const [quotation, setQuotation] = useState<SalesQuotationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [revKey, setRevKey] = useState(0);
  const can = useModuleCan("sales");
  const reopenable = !!quotation && ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(quotation.status);

  async function handleCopyLink() {
    if (!quotation || !me) return;
    const url = `${window.location.origin}/q/${me.tenant.publicKey ?? me.tenant.slug}/${quotation.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt("لینک پیش‌فاکتور برای مشتری:", url);
    }
  }

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
      setRevKey((k) => k + 1);
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

          {quotation.status === "CANCELLED" ? (
            <div className="text-[12.5px] bg-danger-soft border border-border rounded-xl p-3.5 text-danger font-semibold">
              این پیش‌فاکتور باطل شده است{quotation.cancelReason ? ` — ${quotation.cancelReason}` : ""}. لینک عمومی آن برای مشتری «باطل‌شده» نمایش داده می‌شود.
            </div>
          ) : null}

          <RevisionHistory load={() => fetchSalesQuotationRevisions(quotationId)} refreshKey={revKey} />

          <AttachmentsSection entityType="SalesQuotation" entityId={quotation.id} />

          <TasksSection relatedModule="sales" relatedEntityId={quotation.id} />

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
                {can.canEdit ? (
                  <button
                    onClick={() => setEditOpen(true)}
                    disabled={busy}
                    className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    ویرایش
                  </button>
                ) : null}
                {can.canDelete ? (
                  <button
                    onClick={handleDelete}
                    disabled={busy}
                    className="text-[12.5px] font-bold text-danger bg-danger-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    حذف
                  </button>
                ) : null}
              </>
            ) : null}

            {reopenable && can.canEdit ? (
              <button
                onClick={() => setEditOpen(true)}
                disabled={busy}
                className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
              >
                ویرایش (با ثبت دلیل)
              </button>
            ) : null}
            {reopenable && can.canDelete ? (
              <button
                onClick={() => setCancelOpen(true)}
                disabled={busy}
                className="text-[12.5px] font-bold text-danger bg-danger-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
              >
                ابطال پیش‌فاکتور
              </button>
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
                onClick={handleCopyLink}
                className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-4 py-2.5 rounded-xl cursor-pointer"
              >
                {linkCopied ? "لینک کپی شد ✓" : "کپی لینک برای مشتری"}
              </button>
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

      {editOpen && quotation ? (
        <NewQuotationModal
          quotation={quotation}
          onClose={() => setEditOpen(false)}
          onCreated={() => {
            setEditOpen(false);
            reload();
            setRevKey((k) => k + 1);
            onChanged();
          }}
        />
      ) : null}
      {cancelOpen ? (
        <ReasonDialog
          title="ابطال پیش‌فاکتور"
          description="پیش‌فاکتور حذف نمی‌شود؛ با وضعیت «باطل‌شده» و دلیل در تاریخچه می‌ماند، پذیرش آن از لینک عمومی بسته می‌شود و دیگر قابل تبدیل به فاکتور نیست."
          confirmLabel="ابطال پیش‌فاکتور"
          onConfirm={async (reason) => {
            await cancelSalesQuotation(quotationId, reason);
            reload();
            setRevKey((k) => k + 1);
            onChanged();
          }}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
    </Modal>
  );
}
