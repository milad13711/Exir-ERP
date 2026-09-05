import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchSalesInvoice,
  confirmSalesInvoice,
  recordSalesPayment,
  openSalesInvoicePdf,
  signSalesInvoice,
  sendDeliveryCode,
  confirmDelivery,
  ApiError,
  type SalesInvoiceDetail,
  type SalesInvoiceStatus,
  type SalesPaymentMethod,
} from "@/lib/api";
import { NewSalesReturnModal } from "./NewSalesReturnModal";
import { NewShipmentModal } from "@/components/fleet/NewShipmentModal";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { TasksSection } from "@/components/shared/TasksSection";
import { useWorkspace } from "@/lib/workspace-context";

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  DRAFT: "پیش‌نویس",
  CONFIRMED: "تأییدشده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
  CANCELLED: "باطل‌شده",
};

const STATUS_TONES: Record<SalesInvoiceStatus, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  CONFIRMED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

const METHOD_LABELS: Record<SalesPaymentMethod, string> = {
  CASH: "نقدی",
  BANK_TRANSFER: "انتقال بانکی",
  CHECK: "چک",
  POS: "کارت‌خوان",
};

export function InvoiceDetailModal({
  invoiceId,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { installedModules } = useWorkspace();
  const deliverySignatureEnabled = installedModules.has("delivery-signature");
  const [invoice, setInvoice] = useState<SalesInvoiceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<SalesPaymentMethod>("CASH");
  const [checkSayadId, setCheckSayadId] = useState("");
  const [checkDueDate, setCheckDueDate] = useState("");
  const [checkBankName, setCheckBankName] = useState("");
  const [signing, setSigning] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"CODE" | "SIGNATURE" | null>(null);
  const [deliveryCode, setDeliveryCode] = useState("");
  const [confirmerName, setConfirmerName] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);

  function reload() {
    fetchSalesInvoice(invoiceId).then((inv) => {
      setInvoice(inv);
      setPayAmount(String(inv.total - inv.paidAmount));
    });
  }
  useEffect(reload, [invoiceId]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmSalesInvoice(invoiceId);
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
      await recordSalesPayment(invoiceId, {
        amount: Number(payAmount),
        method: payMethod,
        ...(payMethod === "CHECK"
          ? { checkSayadId: checkSayadId.trim(), checkDueDate, checkBankName: checkBankName.trim() || undefined }
          : {}),
      });
      setCheckSayadId("");
      setCheckDueDate("");
      setCheckBankName("");
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleSign(dataUrl: string) {
    setBusy(true);
    setError(null);
    try {
      await signSalesInvoice(invoiceId, dataUrl);
      setSigning(false);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await sendDeliveryCode(invoiceId);
      setDevCode(res.devCode ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDeliveryByCode(e: React.FormEvent) {
    e.preventDefault();
    if (!deliveryCode.trim() || !confirmerName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await confirmDelivery(invoiceId, { method: "CODE", code: deliveryCode.trim(), confirmerName: confirmerName.trim() });
      setDeliveryMethod(null);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDeliveryBySignature(dataUrl: string) {
    if (!confirmerName.trim()) {
      setError("نام تحویل‌گیرنده را وارد کنید");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmDelivery(invoiceId, {
        method: "SIGNATURE",
        signatureDataUrl: dataUrl,
        confirmerName: confirmerName.trim(),
      });
      setDeliveryMethod(null);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  const remaining = invoice ? invoice.total - invoice.paidAmount : 0;
  const canPay = invoice?.status === "CONFIRMED" || invoice?.status === "PARTIALLY_PAID";
  const canSign = invoice && invoice.status !== "DRAFT" && !invoice.signatureDataUrl;
  const canConfirmDelivery = deliverySignatureEnabled && invoice && invoice.status !== "DRAFT" && !invoice.deliveryConfirmedAt;

  const invoiceLabel = invoice
    ? invoice.isOfficial && invoice.officialInvoiceNo
      ? `فاکتور رسمی #${invoice.officialInvoiceNo}`
      : `فاکتور #${invoice.invoiceNo}`
    : "فاکتور فروش";

  return (
    <Modal title={invoiceLabel} onClose={onClose} width="max-w-[600px]">
      {!invoice ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          {invoice.creditWarning ? (
            <div className="bg-danger-soft border border-danger/30 text-danger text-[12px] rounded-xl px-3.5 py-2.5 leading-6">
              ⚠ هشدار اعتباری (فقط داخلی — به مشتری نمایش داده نمی‌شود): {invoice.creditWarning}
            </div>
          ) : null}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[14px] font-extrabold">{invoice.contact.company || invoice.contact.name}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDate(invoice.issuedAt)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {invoice.isOfficial ? <Badge tone="primary">رسمی</Badge> : null}
              <Badge tone={STATUS_TONES[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
            </div>
          </div>

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
                {invoice.lines.map((l) => (
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
              <div className="flex justify-between">
                <span className="text-muted">جمع اقلام</span>
                <span>{formatToman(invoice.subtotal)}</span>
              </div>
              {invoice.discount > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted">تخفیف</span>
                  <span>-{formatToman(invoice.discount)}</span>
                </div>
              ) : null}
              {invoice.taxAmount > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted">مالیات بر ارزش افزوده{invoice.taxRate ? ` (${invoice.taxRate}٪)` : ""}</span>
                  <span>{formatToman(invoice.taxAmount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-extrabold text-[13.5px] pt-1">
                <span>مبلغ نهایی</span>
                <span>{formatToman(invoice.total)}</span>
              </div>
              {invoice.paidAmount > 0 ? (
                <div className="flex justify-between text-success">
                  <span>پرداخت‌شده</span>
                  <span>{formatToman(invoice.paidAmount)}</span>
                </div>
              ) : null}
            </div>
          </div>

          {invoice.payments.length > 0 ? (
            <div>
              <div className="text-[12px] text-muted mb-2">تاریخچه‌ی پرداخت</div>
              <div className="flex flex-col gap-1.5">
                {invoice.payments.map((p) => (
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

          {invoice.notes ? (
            <div className="bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-[12.5px]">
              <div className="text-[11px] text-muted mb-1">یادداشت روی فاکتور</div>
              {invoice.notes}
            </div>
          ) : null}

          {invoice.status !== "DRAFT" ? (
            <div className="flex flex-col gap-2">
              <div className="text-[12px] text-muted">امضا و تحویل</div>

              {invoice.signatureDataUrl ? (
                <div className="flex items-center gap-3 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
                  <img src={invoice.signatureDataUrl} alt="امضا" className="h-10 bg-white rounded-md border border-border" />
                  <div className="text-[12px]">
                    <div className="font-bold">امضای فروشنده: {invoice.signedByName}</div>
                    {invoice.signedAt ? <div className="text-muted">{formatJalaliDate(invoice.signedAt)}</div> : null}
                  </div>
                </div>
              ) : signing ? (
                <SignaturePad onDone={handleSign} onCancel={() => setSigning(false)} />
              ) : canSign ? (
                <button
                  onClick={() => setSigning(true)}
                  disabled={busy}
                  className="w-full py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer"
                >
                  امضای فاکتور
                </button>
              ) : null}

              {deliverySignatureEnabled && invoice.deliveryConfirmedAt ? (
                <div className="flex items-center gap-3 bg-success-soft border border-border rounded-xl px-3.5 py-2.5">
                  {invoice.deliverySignatureDataUrl ? (
                    <img
                      src={invoice.deliverySignatureDataUrl}
                      alt="امضای تحویل"
                      className="h-10 bg-white rounded-md border border-border"
                    />
                  ) : null}
                  <div className="text-[12px]">
                    <div className="font-bold text-success">تحویل تأییدشده توسط {invoice.deliveryConfirmedName}</div>
                    <div className="text-muted">{formatJalaliDate(invoice.deliveryConfirmedAt)}</div>
                  </div>
                </div>
              ) : canConfirmDelivery && deliveryMethod === null ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDeliveryMethod("CODE")}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer"
                  >
                    تأیید تحویل با کد پیامکی
                  </button>
                  <button
                    onClick={() => setDeliveryMethod("SIGNATURE")}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer"
                  >
                    تأیید تحویل با امضا
                  </button>
                </div>
              ) : deliveryMethod === "CODE" ? (
                <form onSubmit={handleConfirmDeliveryByCode} className="flex flex-col gap-2">
                  <input
                    value={confirmerName}
                    onChange={(e) => setConfirmerName(e.target.value)}
                    placeholder="نام تحویل‌گیرنده"
                    className="w-full text-[12.5px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5"
                  />
                  {devCode === null ? (
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={busy}
                      className="w-full py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      ارسال کد به موبایل مشتری
                    </button>
                  ) : (
                    <>
                      {devCode ? (
                        <div className="text-[11.5px] text-warning bg-warning-soft rounded-lg px-3 py-2">
                          پیامک پیکربندی نشده — کد آزمایشی: {devCode}
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <input
                          value={deliveryCode}
                          onChange={(e) => setDeliveryCode(e.target.value.replace(/[^0-9]/g, ""))}
                          dir="ltr"
                          placeholder="کد ۶ رقمی"
                          className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5"
                        />
                        <button
                          type="submit"
                          disabled={busy || !deliveryCode.trim() || !confirmerName.trim()}
                          className="text-[12.5px] font-bold text-white bg-success px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          تأیید
                        </button>
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeliveryMethod(null);
                      setDevCode(null);
                    }}
                    className="text-[11.5px] text-muted cursor-pointer"
                  >
                    انصراف
                  </button>
                </form>
              ) : deliveryMethod === "SIGNATURE" ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={confirmerName}
                    onChange={(e) => setConfirmerName(e.target.value)}
                    placeholder="نام تحویل‌گیرنده"
                    className="w-full text-[12.5px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5"
                  />
                  <SignaturePad onDone={handleConfirmDeliveryBySignature} onCancel={() => setDeliveryMethod(null)} />
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}

          <div className="flex flex-col gap-2.5">
            {invoice.status === "DRAFT" ? (
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                {busy ? "در حال تأیید..." : "تأیید فاکتور — کسر از انبار و ثبت سند حسابداری"}
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

            {invoice.status === "CONFIRMED" || invoice.status === "PARTIALLY_PAID" || invoice.status === "PAID" ? (
              <button
                onClick={() => setReturnModalOpen(true)}
                className="w-full py-2.5 rounded-xl bg-danger-soft text-danger text-[13px] font-bold cursor-pointer"
              >
                ثبت مرجوعی
              </button>
            ) : null}

            <button
              onClick={() => openSalesInvoicePdf(invoiceId)}
              className="w-full py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer"
            >
              دانلود PDF
            </button>

            {installedModules.has("fleet") ? (
              <button
                onClick={() => setShipmentModalOpen(true)}
                className="w-full py-2.5 rounded-xl border border-border text-ink-soft text-[13px] font-bold cursor-pointer"
              >
                ثبت بار برای این فاکتور
              </button>
            ) : null}

            <AttachmentsSection entityType="SalesInvoice" entityId={invoice.id} />

            <TasksSection relatedModule="sales" relatedEntityId={invoice.id} />
          </div>
        </div>
      )}

      {returnModalOpen && invoice ? (
        <NewSalesReturnModal
          invoice={invoice}
          onClose={() => setReturnModalOpen(false)}
          onCreated={() => {
            reload();
            onChanged();
          }}
        />
      ) : null}

      {shipmentModalOpen && invoice ? (
        <NewShipmentModal
          onClose={() => setShipmentModalOpen(false)}
          onCreated={() => setShipmentModalOpen(false)}
          prefill={{
            contactId: invoice.contact.id,
            cargoType: invoice.lines.map((l) => l.description).join("، "),
            quantity: invoice.lines.reduce((sum, l) => sum + l.quantity, 0),
            deliveryAddress: invoice.contact.address ?? undefined,
            sourceType: "SALES_INVOICE",
            sourceInvoiceId: invoice.id,
          }}
        />
      ) : null}
    </Modal>
  );
}
