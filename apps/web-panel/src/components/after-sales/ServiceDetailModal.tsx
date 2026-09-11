"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchAfterSalesService,
  updateAfterSalesServiceStatus,
  sendAfterSalesServiceSms,
  fetchAfterSalesSmsSettings,
  type AfterSalesServiceDetail,
  type WarrantyServiceStatus,
} from "@/lib/api";

const STATUS_LABELS: Record<WarrantyServiceStatus, string> = {
  NEW: "جدید",
  REVIEWING: "در حال بررسی",
  AWAITING_PRODUCT: "در انتظار ارسال کالا",
  IN_PROGRESS: "در حال تعمیر",
  RESOLVED: "برطرف‌شده",
  CLOSED: "بسته‌شده",
};
const STATUSES: WarrantyServiceStatus[] = ["NEW", "REVIEWING", "AWAITING_PRODUCT", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export function ServiceDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [service, setService] = useState<AfterSalesServiceDetail | null>(null);
  const [staffNotes, setStaffNotes] = useState("");
  const [smsText, setSmsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsSent, setSmsSent] = useState(false);
  const [quickTemplates, setQuickTemplates] = useState<{ title: string; text: string }[]>([]);

  function reload() {
    fetchAfterSalesService(id).then((s) => {
      setService(s);
      setStaffNotes(s.staffNotes ?? "");
    });
  }
  useEffect(reload, [id]);
  useEffect(() => {
    fetchAfterSalesSmsSettings().then((s) => setQuickTemplates(s.quickTemplates)).catch(() => setQuickTemplates([]));
  }, []);

  async function handleStatusChange(status: WarrantyServiceStatus) {
    setBusy(true);
    try {
      await updateAfterSalesServiceStatus(id, { status, staffNotes: staffNotes || undefined });
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleSendSms() {
    if (!smsText.trim()) return;
    setBusy(true);
    setError(null);
    setSmsSent(false);
    try {
      await sendAfterSalesServiceSms(id, smsText);
      setSmsSent(true);
      setSmsText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ارسال پیامک ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  if (!service) {
    return (
      <Modal title="درخواست خدمات" onClose={onClose}>
        <div className="text-center text-muted py-6">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={`درخواست خدمات — ${service.warranty.code}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold">{service.warranty.itemDescription ?? service.warranty.code}</span>
          <Badge tone="neutral">{STATUS_LABELS[service.status]}</Badge>
        </div>

        <div className="bg-slate-50 border border-border rounded-xl p-3 text-[13px]">
          <div className="text-muted text-[11.5px] mb-1">شرح مشکل</div>
          {service.description}
        </div>

        {service.photo && <img src={service.photo} alt="تصویر ارسالی مشتری" className="rounded-xl border border-border max-h-64 object-contain" />}

        <div className="text-[12px] text-muted">
          مشتری: {service.warranty.activatedByName ?? "—"} · {service.warranty.activatedByPhone ?? "—"} · ثبت‌شده در {formatJalaliDateTime(service.createdAt)}
        </div>

        <div>
          <div className="text-[12px] font-semibold text-ink-soft mb-2">تغییر وضعیت</div>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={busy || s === service.status}
                className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 cursor-pointer ${
                  s === service.status ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft"
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">یادداشت داخلی</span>
          <textarea
            value={staffNotes}
            onChange={(e) => setStaffNotes(e.target.value)}
            onBlur={() => handleStatusChange(service.status)}
            rows={2}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary resize-none"
          />
        </label>

        {service.warranty.activatedByPhone && (
          <div className="border-t border-border pt-4">
            <div className="text-[12px] font-semibold text-ink-soft mb-2">ارسال پیامک به مشتری</div>
            {quickTemplates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {quickTemplates.map((t) => (
                  <button
                    key={t.title}
                    onClick={() => setSmsText(t.text)}
                    className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 text-ink-soft cursor-pointer"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder="متن پیامک... ({name} و {code} جایگزین می‌شوند)"
              rows={2}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary resize-none"
            />
            {error && <div className="text-[12px] text-danger mt-1.5">{error}</div>}
            {smsSent && <div className="text-[12px] text-success mt-1.5">پیامک ارسال شد</div>}
            <button
              onClick={handleSendSms}
              disabled={!smsText.trim() || busy}
              className="mt-2 text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-primary-soft text-primary disabled:opacity-50 cursor-pointer"
            >
              ارسال پیامک
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
