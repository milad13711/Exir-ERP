"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { CompassIcon } from "@/components/icons";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchWarrantyCode, voidWarrantyCode, extendWarrantyCode, type WarrantyCodeDetail, type WarrantyCodeStatus } from "@/lib/api";

const STATUS_LABELS: Record<WarrantyCodeStatus, string> = { PENDING: "صادرشده، فعال نشده", ACTIVE: "فعال", EXPIRED: "منقضی", VOID: "باطل‌شده" };
const STATUS_TONES: Record<WarrantyCodeStatus, "neutral" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  ACTIVE: "success",
  EXPIRED: "warning",
  VOID: "danger",
};

export function WarrantyDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [warranty, setWarranty] = useState<WarrantyCodeDetail | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [busy, setBusy] = useState(false);

  function reload() {
    fetchWarrantyCode(id).then(setWarranty).catch(() => setWarranty(null));
  }
  useEffect(reload, [id]);

  async function handleVoid() {
    if (!confirm("این گارانتی باطل شود؟")) return;
    setBusy(true);
    try {
      await voidWarrantyCode(id);
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleExtend() {
    if (!extendDate) return;
    setBusy(true);
    try {
      await extendWarrantyCode(id, extendDate);
      setExtendDate("");
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!warranty) {
    return (
      <Modal title="جزئیات گارانتی" onClose={onClose}>
        <div className="text-center text-muted py-6">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={`گارانتی ${warranty.code}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-lg font-extrabold tracking-wider" dir="ltr">
            {warranty.code}
          </span>
          <Badge tone={STATUS_TONES[warranty.status]}>{STATUS_LABELS[warranty.status]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <Row label="کالا" value={warranty.itemDescription ?? warranty.product?.name ?? "—"} />
          <Row label="سریال" value={warranty.serialNumber ?? "—"} />
          <Row label="فاکتور" value={warranty.invoice ? `#${warranty.invoice.invoiceNo}` : warranty.manualInvoiceNumber ?? "بدون فاکتور"} />
          <Row label="مدت گارانتی" value={`${toPersianDigits(warranty.durationDays)} روز`} />
          <Row label="تاریخ صدور" value={formatJalaliDateTime(warranty.issuedAt)} />
          <Row label="تاریخ فعال‌سازی" value={warranty.activatedAt ? formatJalaliDateTime(warranty.activatedAt) : "—"} />
          <Row label="تاریخ انقضا" value={warranty.expiresAt ? formatJalaliDateTime(warranty.expiresAt) : "—"} />
        </div>

        {(warranty.activatedByName || warranty.activatedByPhone) && (
          <div className="bg-slate-50 border border-border rounded-xl p-3 text-[13px]">
            <div className="font-bold mb-1.5">فعال‌کننده</div>
            <Row label="نام" value={warranty.activatedByName ?? "—"} />
            <Row label="موبایل" value={warranty.activatedByPhone ?? "—"} />
          </div>
        )}

        {warranty.services.length > 0 && (
          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-2">درخواست‌های خدمات پس از فروش</div>
            <div className="flex flex-col gap-1.5">
              {warranty.services.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
                  <CompassIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-[12px] flex-1 truncate">{s.description}</span>
                  <Badge tone="neutral">{s.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {warranty.status !== "VOID" && (
          <div className="border-t border-border pt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <JalaliDateInput value={extendDate} onChange={setExtendDate} placeholder="تاریخ جدید انقضا" className="flex-1" />
              <button
                onClick={handleExtend}
                disabled={!extendDate || busy}
                className="text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-primary-soft text-primary disabled:opacity-50 cursor-pointer"
              >
                تمدید تا این تاریخ
              </button>
            </div>
            <button
              onClick={handleVoid}
              disabled={busy}
              className="text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-danger-soft text-danger disabled:opacity-50 cursor-pointer"
            >
              باطل کردن گارانتی
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/60 py-1.5">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
