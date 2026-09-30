import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchRecurringInvoice,
  updateRecurringInvoice,
  deleteRecurringInvoice,
  type RecurringInvoiceDetail,
  type RecurrenceFrequency,
} from "@/lib/api";
import { NewRecurringInvoiceModal } from "./NewRecurringInvoiceModal";

const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  WEEKLY: "هفتگی",
  MONTHLY: "ماهانه",
  QUARTERLY: "فصلی",
  YEARLY: "سالانه",
};

export function RecurringInvoiceDetailModal({
  templateId,
  onClose,
  onChanged,
}: {
  templateId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [template, setTemplate] = useState<RecurringInvoiceDetail | null>(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  function load() {
    fetchRecurringInvoice(templateId).then(setTemplate);
  }
  useEffect(load, [templateId]);

  async function handleToggleActive() {
    if (!template) return;
    setToggling(true);
    try {
      await updateRecurringInvoice(templateId, { isActive: !template.isActive });
      load();
      onChanged();
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("این الگوی تکرارشونده حذف شود؟ فاکتورهای قبلاً صادرشده از آن دست‌نخورده می‌مانند.")) return;
    setDeleting(true);
    try {
      await deleteRecurringInvoice(templateId);
      onChanged();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal title="فاکتور تکرارشونده" onClose={onClose} width="max-w-[560px]">
      {!template ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-extrabold">{template.contact.company || template.contact.name}</div>
              <div className="text-[12px] text-muted mt-1">
                {FREQUENCY_LABELS[template.frequency]}
                {template.intervalCount > 1 ? ` (هر ${template.intervalCount} دوره)` : ""}
              </div>
            </div>
            <Badge tone={template.isActive ? "success" : "neutral"}>{template.isActive ? "فعال" : "غیرفعال"}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
            <div>
              <div className="text-[11px] text-muted">صدور بعدی</div>
              <div className="text-[13px] font-bold mt-0.5">{formatJalaliDate(template.nextRunAt)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">آخرین صدور</div>
              <div className="text-[13px] font-bold mt-0.5">
                {template.lastRunAt ? formatJalaliDate(template.lastRunAt) : "هنوز صادر نشده"}
              </div>
            </div>
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">اقلام</div>
            <div className="flex flex-col gap-1.5">
              {template.lines.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-[12.5px] bg-slate-50 rounded-lg px-3 py-2">
                  <span>{l.description}</span>
                  <span className="text-muted">
                    {l.quantity} × {formatToman(l.unitPrice)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {template.notes ? <div className="text-[12px] text-muted">یادداشت: {template.notes}</div> : null}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {deleting ? "در حال حذف..." : "حذف الگو"}
              </button>
              <button
                onClick={() => setEditOpen(true)}
                className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
              >
                ویرایش
              </button>
            </div>
            <button
              onClick={handleToggleActive}
              disabled={toggling}
              className="text-[11.5px] font-bold text-accent bg-accent-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {toggling ? "..." : template.isActive ? "غیرفعال کردن" : "فعال کردن"}
            </button>
          </div>
        </div>
      )}

      {editOpen && template ? (
        <NewRecurringInvoiceModal
          template={template}
          onClose={() => setEditOpen(false)}
          onCreated={() => {
            setEditOpen(false);
            load();
            onChanged();
          }}
        />
      ) : null}
    </Modal>
  );
}
