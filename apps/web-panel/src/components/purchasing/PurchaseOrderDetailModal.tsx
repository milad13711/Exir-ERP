import { NewPurchaseOrderModal } from "./NewPurchaseOrderModal";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { cancelPurchaseOrder, deletePurchaseOrder, deletePurchaseReturn } from "@/lib/api";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchPurchaseOrder,
  fetchPurchaseReturns,
  receivePurchaseOrder,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  recordPurchasePayment,
  ApiError,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
  type SalesPaymentMethod,
  type PurchaseReturn,
} from "@/lib/api";
import { NewPurchaseReturnModal } from "./NewPurchaseReturnModal";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";


/** تاریخ امروز به‌صورت YYYY-MM-DD محلی — مقدار پیش‌فرض «تاریخ پرداخت». */
function todayIsoLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  RECEIVED: "دریافت‌شده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
  CANCELLED: "باطل‌شده",
};

const STATUS_TONES: Record<PurchaseOrderStatus, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  RECEIVED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

const METHOD_LABELS: Record<SalesPaymentMethod, string> = {
  CASH: "نقدی",
  BANK_TRANSFER: "انتقال بانکی",
  CHECK: "چک",
  ONLINE_GATEWAY: "پرداخت آنلاین",
  POS: "کارت‌خوان",
};

export function PurchaseOrderDetailModal({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<SalesPaymentMethod>("CASH");
  const [checkSayadId, setCheckSayadId] = useState("");
  const [checkDueDate, setCheckDueDate] = useState("");
  const [paidDate, setPaidDate] = useState(() => todayIsoLocal());
  const [checkBankName, setCheckBankName] = useState("");
  const [orderReturns, setOrderReturns] = useState<PurchaseReturn[]>([]);

  function reload() {
    fetchPurchaseOrder(orderId).then((o) => {
      setOrder(o);
      setPayAmount(String(o.total - o.paidAmount));
    });
    fetchPurchaseReturns()
      .then((rs) => setOrderReturns(rs.filter((r) => r.order.id === orderId)))
      .catch(() => setOrderReturns([]));
  }
  useEffect(reload, [orderId]);

  async function handleReceive() {
    setBusy(true);
    setError(null);
    try {
      await receivePurchaseOrder(orderId);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approvePurchaseOrder(orderId);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    const reason = window.prompt("دلیل رد سفارش (اختیاری):") ?? undefined;
    setBusy(true);
    setError(null);
    try {
      await rejectPurchaseOrder(orderId, reason || undefined);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!Number(payAmount)) return;
    if (payMethod === "CHECK" && (!checkSayadId.trim() || !checkDueDate)) return;
    setBusy(true);
    setError(null);
    try {
      await recordPurchasePayment(orderId, {
        amount: Number(payAmount),
        method: payMethod,
        ...(paidDate && paidDate !== todayIsoLocal() ? { paidAt: `${paidDate}T12:00:00` } : {}),
        ...(payMethod === "CHECK"
          ? { checkSayadId: checkSayadId.trim(), checkDueDate, checkBankName: checkBankName.trim() || undefined }
          : {}),
      });
      setCheckSayadId("");
      setCheckDueDate("");
      setCheckBankName("");
      setPaidDate(todayIsoLocal());
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  const remaining = order ? order.total - order.paidAmount : 0;
  const canPay = order?.status === "RECEIVED" || order?.status === "PARTIALLY_PAID";

  return (
    <Modal title={order ? `سفارش خرید #${order.orderNo}` : "سفارش خرید"} onClose={onClose} width="max-w-[600px]">
      {!order ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[14px] font-extrabold">{order.supplier.company || order.supplier.name}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDate(order.issuedAt)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {order.approvalStatus === "PENDING" ? <Badge tone="warning">در انتظار تأیید</Badge> : null}
              {order.approvalStatus === "REJECTED" ? <Badge tone="danger">رد شده</Badge> : null}
              {order.hasReturn ? (
                <Badge tone="danger">مرجوع‌شده</Badge>
              ) : (
                <Badge tone={STATUS_TONES[order.status]}>{STATUS_LABELS[order.status]}</Badge>
              )}
            </div>
          </div>

          {order.approvalStatus === "REJECTED" && order.rejectionReason ? (
            <div className="bg-danger-soft text-danger text-[12px] rounded-xl px-3.5 py-2.5">
              دلیل رد: {order.rejectionReason}
            </div>
          ) : null}

          <div className="bg-slate-50 border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start text-[11px] text-muted font-semibold py-2 px-3">شرح</th>
                  <th className="text-center text-[11px] text-muted font-semibold py-2 px-2">تعداد</th>
                  <th className="text-start text-[11px] text-muted font-semibold py-2 px-3">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-b-0">
                    <td className="py-2 px-3 text-[12.5px]">{l.description}</td>
                    <td className="py-2 px-2 text-[12.5px] text-center">{l.quantity}</td>
                    <td className="py-2 px-3 text-[12.5px] font-bold">{formatToman(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="px-3 py-2.5 border-t border-border flex flex-col gap-1 text-[12.5px]">
              <div className="flex justify-between font-extrabold text-[13.5px]">
                <span>مبلغ کل سفارش</span>
                <span>{formatToman(order.total)}</span>
              </div>
              {order.paidAmount > 0 ? (
                <div className="flex justify-between text-success">
                  <span>پرداخت‌شده</span>
                  <span>{formatToman(order.paidAmount)}</span>
                </div>
              ) : null}
            </div>
          </div>

          {order.payments.length > 0 ? (
            <div>
              <div className="text-[12px] text-muted mb-2">تاریخچه‌ی پرداخت</div>
              <div className="flex flex-col gap-1.5">
                {order.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-[12px] px-1">
                    <span className="text-ink-soft">
                      {METHOD_LABELS[p.method]} · {formatJalaliDate(p.paidAt)}
                    </span>
                    <span className="font-bold">{formatToman(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {orderReturns.length > 0 ? (
            <div>
              <div className="text-[12px] text-muted mb-2">مرجوعی‌های این سفارش</div>
              <div className="flex flex-col gap-2">
                {orderReturns.map((r) => (
                  <div key={r.id} className="bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div className="text-[12px]">
                      <div className="font-bold">
                        مرجوعی #{r.returnNo} — {formatToman(r.total)}
                      </div>
                      <div className="text-muted mt-0.5">
                        {formatJalaliDate(r.createdAt)}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </div>
                    </div>
                    <div className="[&>div]:mt-0! [&>div]:pt-0! [&>div]:border-t-0!">
                      <DeleteRecordButton
                        label="حذف مرجوعی"
                        confirmText="این مرجوعی حذف شود؟ سند حسابداری و موجودی انبار با سند معکوس برگردانده می‌شود."
                        onDelete={() => deletePurchaseReturn(r.id)}
                        onDeleted={() => {
                          reload();
                          onChanged();
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}

          <div className="flex flex-col gap-2.5">
            {order.status === "DRAFT" && order.approvalStatus === "PENDING" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApprove}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-success text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
                >
                  تأیید سفارش
                </button>
                <button
                  onClick={handleReject}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-danger text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
                >
                  رد سفارش
                </button>
              </div>
            ) : null}

            {order.status === "DRAFT" && order.approvalStatus !== "PENDING" && order.approvalStatus !== "REJECTED" ? (
              <button
                onClick={handleReceive}
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                {busy ? "در حال ثبت..." : "دریافت کالا — افزایش موجودی انبار و ثبت سند حسابداری"}
              </button>
            ) : null}

            {canPay ? (
              <form onSubmit={handlePay} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9]/g, ""))}
                    dir="ltr"
                    className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5"
                    placeholder="مبلغ"
                  />
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as SalesPaymentMethod)}
                    className="text-[12.5px] bg-slate-50 border border-border rounded-xl px-2.5 py-2.5 outline-none"
                  >
                    {Object.entries(METHOD_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-ink-soft shrink-0">تاریخ پرداخت</span>
                  <div className="w-[170px]">
                    <JalaliDateInput value={paidDate} onChange={(v) => setPaidDate(v || todayIsoLocal())} placeholder="تاریخ پرداخت" />
                  </div>
                  <span className="text-[11px] text-muted">برای پرداختِ قبلی تاریخ واقعی را انتخاب کنید</span>
                </div>

                {payMethod === "CHECK" ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={checkSayadId}
                      onChange={(e) => setCheckSayadId(e.target.value.replace(/[^0-9]/g, ""))}
                      dir="ltr"
                      placeholder="شماره صیادی چک"
                      className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5"
                    />
                    <div className="w-[150px]">
                      <JalaliDateInput value={checkDueDate} onChange={setCheckDueDate} placeholder="سررسید" />
                    </div>
                    <input
                      value={checkBankName}
                      onChange={(e) => setCheckBankName(e.target.value)}
                      placeholder="بانک (اختیاری)"
                      className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5"
                    />
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={
                    busy ||
                    !Number(payAmount) ||
                    Number(payAmount) > remaining ||
                    (payMethod === "CHECK" && (!checkSayadId.trim() || !checkDueDate))
                  }
                  className="w-full text-[12.5px] font-bold text-white bg-success px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  ثبت پرداخت
                </button>
              </form>
            ) : null}

            {order.status === "RECEIVED" || order.status === "PARTIALLY_PAID" || order.status === "PAID" ? (
              <button
                onClick={() => setReturnModalOpen(true)}
                className="w-full py-2.5 rounded-xl bg-danger-soft text-danger text-[13px] font-bold cursor-pointer"
              >
                ثبت مرجوعی
              </button>
            ) : null}

            <AttachmentsSection entityType="PurchaseOrder" entityId={order.id} />
          </div>
        </div>
      )}

      {returnModalOpen && order ? (
        <NewPurchaseReturnModal
          order={order}
          onClose={() => setReturnModalOpen(false)}
          onCreated={() => {
            reload();
            onChanged();
          }}
        />
      ) : null}
      {order && order.status === "DRAFT" ? (
        <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
          <button onClick={() => setEditOpen(true)} className="text-[12px] font-bold text-primary bg-primary-soft px-3.5 py-2 rounded-lg cursor-pointer">
            ویرایش سفارش
          </button>
          <button
            onClick={async () => {
              const reason = window.prompt("دلیل لغو سفارش:");
              if (!reason) return;
              try {
                await cancelPurchaseOrder(order.id, reason);
                onChanged();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "لغو ناموفق بود");
              }
            }}
            className="text-[12px] font-bold text-warning bg-warning-soft px-3.5 py-2 rounded-lg cursor-pointer"
          >
            لغو سفارش
          </button>
          <div className="mr-auto">
            <DeleteRecordButton
              confirmText="این سفارش پیش‌نویس حذف شود؟"
              onDelete={() => deletePurchaseOrder(order.id)}
              onDeleted={() => {
                onChanged();
                onClose();
              }}
            />
          </div>
        </div>
      ) : null}
      {editOpen && order ? (
        <NewPurchaseOrderModal
          order={order}
          onClose={() => setEditOpen(false)}
          onCreated={() => {
            onChanged();
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}
