"use client";

import { useState } from "react";
import { CloseIcon, PhoneIcon } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { updateStoreOrderStatus, ApiError, type StoreOrder, type StoreOrderStatus } from "@/lib/api";

export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  PENDING: "در انتظار تأیید",
  CONFIRMED: "تأییدشده",
  PACKED: "بسته‌بندی‌شده",
  SHIPPED: "ارسال‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELLED: "لغوشده",
};

export const STORE_ORDER_STATUS_TONES: Record<StoreOrderStatus, "primary" | "success" | "neutral" | "danger" | "warning"> = {
  PENDING: "warning",
  CONFIRMED: "primary",
  PACKED: "primary",
  SHIPPED: "success",
  DELIVERED: "success",
  CANCELLED: "danger",
};

const NEXT_STATUS: Partial<Record<StoreOrderStatus, StoreOrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "PACKED",
  PACKED: "SHIPPED",
  SHIPPED: "DELIVERED",
};

export function OrderDetailModal({
  order,
  onClose,
  onChanged,
}: {
  order: StoreOrder;
  onClose: () => void;
  onChanged: (o: StoreOrder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackingCode, setTrackingCode] = useState(order.trackingCode ?? "");

  async function setStatus(status: StoreOrderStatus) {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateStoreOrderStatus(order.id, { status, trackingCode: trackingCode.trim() || undefined });
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "بروزرسانی وضعیت با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  const nextStatus = NEXT_STATUS[order.status];
  const canCancel = order.status !== "DELIVERED" && order.status !== "CANCELLED";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-[560px] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-border sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-[15px] font-extrabold">سفارش #{toPersianDigits(order.orderNo)}</h2>
            <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDateTime(order.createdAt)}</div>
          </div>
          <button onClick={onClose} className="text-muted cursor-pointer">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge tone={STORE_ORDER_STATUS_TONES[order.status]}>{STORE_ORDER_STATUS_LABELS[order.status]}</Badge>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 flex flex-col gap-1.5">
            <div className="text-[13px] font-bold">{order.customerName}</div>
            <div className="text-[12px] text-ink-soft flex items-center gap-1.5" dir="ltr">
              <PhoneIcon className="w-3.5 h-3.5" />
              {order.customerPhone}
            </div>
            <div className="text-[12px] text-ink-soft mt-1">{order.shippingAddress}</div>
            {order.notes ? <div className="text-[11.5px] text-muted mt-1">یادداشت: {order.notes}</div> : null}
          </div>

          <div className="flex flex-col gap-2">
            {order.lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-[12.5px] py-2 border-b border-border">
                <span>
                  {l.productName} <span className="text-muted">× {toPersianDigits(l.quantity)}</span>
                </span>
                <span className="font-bold">{formatToman(l.lineTotal)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-[14px] font-extrabold pt-1">
              <span>جمع کل</span>
              <span>{formatToman(order.subtotal)}</span>
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">کد رهگیری مرسوله (اختیاری)</label>
            <input
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              dir="ltr"
              placeholder="مثلاً کد رهگیری پست"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
            />
          </div>

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}

          <div className="flex items-center gap-2">
            {nextStatus ? (
              <button
                disabled={busy}
                onClick={() => setStatus(nextStatus)}
                className="flex-1 py-3 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
              >
                علامت‌گذاری به «{STORE_ORDER_STATUS_LABELS[nextStatus]}»
              </button>
            ) : null}
            {canCancel ? (
              <button
                disabled={busy}
                onClick={() => setStatus("CANCELLED")}
                className="px-4 py-3 rounded-xl bg-danger-soft text-danger text-[13px] font-bold cursor-pointer disabled:opacity-50"
              >
                لغو سفارش
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
