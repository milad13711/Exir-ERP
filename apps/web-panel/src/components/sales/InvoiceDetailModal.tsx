import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  fetchSalesInvoice,
  confirmSalesInvoice,
  recordSalesPayment,
  openSalesInvoicePdf,
  sendSalesInvoicePaymentLink,
  fetchSalesInvoiceOnlinePaymentLink,
  signSalesInvoice,
  sendDeliveryCode,
  confirmDelivery,
  fetchWarrantyInvoiceHasIssuable,
  issueWarrantyFromInvoiceNow,
  fetchInvoiceReturnable,
  fetchSalesReturns,
  deleteSalesReturn,
  ApiError,
  type SalesInvoiceDetail,
  type SalesInvoiceStatus,
  type SalesPaymentMethod,
  type SalesInvoicePaymentMethod,
  type SalesReturn,
} from "@/lib/api";
import { NewSalesReturnModal } from "./NewSalesReturnModal";
import { NewInvoiceModal } from "./NewInvoiceModal";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { cancelSalesInvoice, deleteSalesInvoice } from "@/lib/api";
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
  ONLINE_GATEWAY: "پرداخت آنلاین",
};

const INVOICE_PAYMENT_METHOD_LABELS: Record<SalesInvoicePaymentMethod, string> = {
  BANK_TRANSFER: "کارت/حساب بانکی",
  ONLINE_GATEWAY: "درگاه پرداخت آنلاین",
  CASH: "نقدی",
  CHECK: "چکی",
};

const CHECK_STATUS_LABELS: Record<string, string> = {
  PENDING: "نزد ما",
  DEPOSITED: "واگذارشده به بانک",
  CLEARED: "وصول‌شده",
  BOUNCED: "برگشتی",
  CANCELLED: "باطل‌شده",
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const [editOpen, setEditOpen] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<SalesPaymentMethod>("CASH");
  const [checkSayadId, setCheckSayadId] = useState("");
  const [checkDueDate, setCheckDueDate] = useState("");
  const [checkBankName, setCheckBankName] = useState("");
  const [checkPhotoDataUrl, setCheckPhotoDataUrl] = useState<string | undefined>(undefined);
  const [onlinePayBusy, setOnlinePayBusy] = useState(false);
  const [onlinePayUrl, setOnlinePayUrl] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"CODE" | "SIGNATURE" | null>(null);
  const [deliveryCode, setDeliveryCode] = useState("");
  const [confirmerName, setConfirmerName] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [linkSentUrl, setLinkSentUrl] = useState<string | null>(null);
  const [hasIssuableWarranty, setHasIssuableWarranty] = useState(false);
  const [issuingWarranty, setIssuingWarranty] = useState(false);
  const [warrantyIssuedCount, setWarrantyIssuedCount] = useState<number | null>(null);
  const [hasReturnable, setHasReturnable] = useState(false);
  const [invoiceReturns, setInvoiceReturns] = useState<SalesReturn[]>([]);

  function reload() {
    const isFirstLoad = invoice === null;
    fetchSalesInvoice(invoiceId).then((inv) => {
      setInvoice(inv);
      setPayAmount(String(inv.total - inv.paidAmount));
      // اولین‌باری که فاکتور بارگذاری می‌شود، روش ثبت پرداخت را با روش انتخابی هنگام صدور فاکتور
      // هم‌راستا کن — وگرنه فرم همیشه با «نقدی» شروع می‌شود حتی برای فاکتور بانکی/چکی/آنلاین.
      if (isFirstLoad) setPayMethod(inv.paymentMethod as SalesPaymentMethod);
    });
    fetchInvoiceReturnable(invoiceId)
      .then((r) => setHasReturnable(r.hasReturnable))
      .catch(() => setHasReturnable(false));
    fetchSalesReturns()
      .then((rs) => setInvoiceReturns(rs.filter((r) => r.invoice.id === invoiceId)))
      .catch(() => setInvoiceReturns([]));
    if (installedModules.has("warranty")) {
      fetchWarrantyInvoiceHasIssuable(invoiceId)
        .then((r) => setHasIssuableWarranty(r.hasIssuable))
        .catch(() => setHasIssuableWarranty(false));
    }
  }
  // installedModules از context گرفته می‌شود و در طول عمر این مودال ثابت است — عمداً در dependency نیست
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [invoiceId]);

  async function handleIssueWarranty() {
    setIssuingWarranty(true);
    setError(null);
    setWarrantyIssuedCount(null);
    try {
      const res = await issueWarrantyFromInvoiceNow(invoiceId);
      setWarrantyIssuedCount(res.issued.length);
      setHasIssuableWarranty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "صدور گارانتی ناموفق بود");
    } finally {
      setIssuingWarranty(false);
    }
  }

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
          ? {
              checkSayadId: checkSayadId.trim(),
              checkDueDate,
              checkBankName: checkBankName.trim() || undefined,
              checkPhotoDataUrl,
            }
          : {}),
      });
      setCheckSayadId("");
      setCheckDueDate("");
      setCheckBankName("");
      setCheckPhotoDataUrl(undefined);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendPaymentLink() {
    setBusy(true);
    setError(null);
    setLinkSentUrl(null);
    try {
      const res = await sendSalesInvoicePaymentLink(invoiceId);
      setLinkSentUrl(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارسال پیامک ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleGetOnlinePaymentLink() {
    setOnlinePayBusy(true);
    setError(null);
    setOnlinePayUrl(null);
    try {
      const res = await fetchSalesInvoiceOnlinePaymentLink(invoiceId);
      setOnlinePayUrl(res.paymentUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "اتصال به درگاه پرداخت ناموفق بود");
    } finally {
      setOnlinePayBusy(false);
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
              <div className="text-[11.5px] text-muted mt-0.5">
                {formatJalaliDate(invoice.issuedAt)}
                {invoice.dueAt ? ` · سررسید: ${formatJalaliDate(invoice.dueAt)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {invoice.isOfficial ? <Badge tone="primary">رسمی</Badge> : null}
              {invoice.hasReturn ? (
                <Badge tone="danger">مرجوع‌شده</Badge>
              ) : (
                <Badge tone={STATUS_TONES[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
              )}
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

          <div className="bg-primary-soft border border-border rounded-xl px-3.5 py-2 text-[12px] font-bold text-primary w-fit">
            روش پرداخت: {INVOICE_PAYMENT_METHOD_LABELS[invoice.paymentMethod]}
          </div>

          {invoice.notes || (invoice.paymentMethod === "BANK_TRANSFER" && invoice.paymentBankInfo) ? (
            <div className="bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-[12.5px] flex flex-col gap-1.5">
              <div className="text-[11px] text-muted mb-0.5">یادداشت روی فاکتور</div>
              {invoice.paymentMethod === "BANK_TRANSFER" && invoice.paymentBankInfo ? (
                <div className="font-bold" dir="ltr">
                  {invoice.paymentBankInfo}
                </div>
              ) : null}
              {invoice.notes ? <div>{invoice.notes}</div> : null}
            </div>
          ) : null}

          {invoice.paymentMethod === "CHECK" ? (
            <div className="bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-[12.5px]">
              <div className="text-[11px] text-muted mb-1.5">جزئیات چک</div>
              {invoice.checks.length === 0 ? (
                <div className="text-muted">هنوز چکی برای این فاکتور ثبت نشده — از فرم «ثبت پرداخت» با روش «چک» وارد کنید.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {invoice.checks.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 bg-white border border-border rounded-lg px-2.5 py-2">
                      <div>
                        <div className="font-bold" dir="ltr">
                          {c.sayadId}
                        </div>
                        <div className="text-muted text-[11.5px]">
                          {formatToman(c.amount)} · سررسید {formatJalaliDate(c.dueDate)} · {CHECK_STATUS_LABELS[c.status] ?? c.status}
                        </div>
                      </div>
                      {c.photoDataUrl ? (
                        <img src={c.photoDataUrl} alt="عکس چک" className="h-12 w-16 object-cover rounded-md border border-border" />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {invoiceReturns.length > 0 ? (
            <div>
              <div className="text-[12px] text-muted mb-2">مرجوعی‌های این فاکتور</div>
              <div className="flex flex-col gap-2">
                {invoiceReturns.map((r) => (
                  <div key={r.id} className="bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div className="text-[12px]">
                      <div className="font-bold">مرجوعی #{r.returnNo} — {formatToman(r.total)}</div>
                      <div className="text-muted mt-0.5">{formatJalaliDate(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}</div>
                    </div>
                    <DeleteRecordButton
                      label="حذف مرجوعی"
                      confirmText="این مرجوعی حذف شود؟ سند حسابداری و موجودی انبار با سند معکوس برگردانده می‌شود."
                      onDelete={() => deleteSalesReturn(r.id)}
                      onDeleted={() => {
                        reload();
                        onChanged();
                      }}
                    />
                  </div>
                ))}
              </div>
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
                  <div className="flex flex-col gap-2">
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
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) setCheckPhotoDataUrl(await readAsDataUrl(file));
                        }}
                        className="flex-1 text-[11.5px] text-muted"
                      />
                      {checkPhotoDataUrl ? (
                        <img src={checkPhotoDataUrl} alt="عکس چک" className="h-10 w-14 object-cover rounded-md border border-border" />
                      ) : null}
                    </div>
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

            {canPay && invoice.paymentMethod === "ONLINE_GATEWAY" ? (
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handleGetOnlinePaymentLink}
                  disabled={onlinePayBusy}
                  className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
                >
                  {onlinePayBusy ? "در حال اتصال به درگاه..." : "دریافت لینک پرداخت آنلاین"}
                </button>
                {onlinePayUrl && (
                  <a
                    href={onlinePayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11.5px] text-primary bg-primary-soft rounded-lg px-3 py-2 break-all"
                    dir="ltr"
                  >
                    {onlinePayUrl}
                  </a>
                )}
              </div>
            ) : null}

            {(invoice.status === "CONFIRMED" || invoice.status === "PARTIALLY_PAID" || invoice.status === "PAID") && hasReturnable ? (
              <button
                onClick={() => setReturnModalOpen(true)}
                className="w-full py-2.5 rounded-xl bg-danger-soft text-danger text-[13px] font-bold cursor-pointer"
              >
                ثبت مرجوعی
              </button>
            ) : null}

            <div className="flex gap-2">
              <button
                onClick={() => openSalesInvoicePdf(invoiceId)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer"
              >
                دانلود PDF
              </button>
              {(invoice.status === "CONFIRMED" || invoice.status === "PARTIALLY_PAID" || invoice.status === "PAID") && (
                <button
                  onClick={handleSendPaymentLink}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-primary-soft text-primary text-[13px] font-bold cursor-pointer disabled:opacity-50"
                >
                  ارسال لینک فاکتور با پیامک
                </button>
              )}
            </div>
            {linkSentUrl && (
              <div className="text-[11.5px] text-success bg-success-soft rounded-lg px-3 py-2 break-all" dir="ltr">
                پیامک ارسال شد — {linkSentUrl}
              </div>
            )}

            {installedModules.has("fleet") ? (
              <button
                onClick={() => setShipmentModalOpen(true)}
                className="w-full py-2.5 rounded-xl border border-border text-ink-soft text-[13px] font-bold cursor-pointer"
              >
                ثبت بار برای این فاکتور
              </button>
            ) : null}

            {installedModules.has("warranty") && hasIssuableWarranty ? (
              <button
                onClick={handleIssueWarranty}
                disabled={issuingWarranty}
                className="w-full py-2.5 rounded-xl border border-border text-ink-soft text-[13px] font-bold cursor-pointer disabled:opacity-50"
              >
                {issuingWarranty ? "در حال صدور..." : "صدور گارانتی برای اقلام این فاکتور"}
              </button>
            ) : null}
            {warrantyIssuedCount != null && (
              <div className="text-[12px] text-success bg-success-soft rounded-lg px-3 py-2">
                {toPersianDigits(warrantyIssuedCount)} کد گارانتی صادر شد — از ماژول «گارانتی» قابل مشاهده است
              </div>
            )}

            <AttachmentsSection entityType="SalesInvoice" entityId={invoice.id} />

            <TasksSection relatedModule="sales" relatedEntityId={invoice.id} />
          </div>
        </div>
      )}

      {invoice && invoice.status === "DRAFT" ? (
        <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
          <button onClick={() => setEditOpen(true)} className="text-[12px] font-bold text-primary bg-primary-soft px-3.5 py-2 rounded-lg cursor-pointer">
            ویرایش پیش‌نویس
          </button>
          <div className="mr-auto">
            <DeleteRecordButton
              confirmText="این فاکتور پیش‌نویس حذف شود؟"
              onDelete={() => deleteSalesInvoice(invoice.id)}
              onDeleted={() => {
                onChanged();
                onClose();
              }}
            />
          </div>
        </div>
      ) : null}
      {invoice && invoice.status === "CONFIRMED" && invoice.paidAmount === 0 ? (
        <div className="mt-4 pt-3 border-t border-border flex items-center gap-3 flex-wrap">
          <button
            onClick={async () => {
              const reason = window.prompt("دلیل ابطال فاکتور (برای سند معکوس و سابقه):");
              if (!reason || reason.trim().length < 3) return;
              try {
                const res = await cancelSalesInvoice(invoice.id, reason.trim());
                setCancelMsg(res.pendingApproval ? "درخواست ابطال در کارتابل مدیر ثبت شد؛ پس از تأیید مدیر اجرا می‌شود." : "فاکتور باطل شد و سند معکوس و برگشت موجودی ثبت شد.");
                reload();
                onChanged();
              } catch (err) {
                setCancelMsg(err instanceof Error ? err.message : "ابطال ناموفق بود");
              }
            }}
            className="text-[12px] font-bold text-danger bg-danger-soft px-3.5 py-2 rounded-lg cursor-pointer"
          >
            ابطال فاکتور
          </button>
          {cancelMsg && <span className="text-[12px] font-semibold text-ink-soft">{cancelMsg}</span>}
        </div>
      ) : null}
      {editOpen && invoice ? (
        <NewInvoiceModal
          invoice={invoice}
          onClose={() => setEditOpen(false)}
          onCreated={() => {
            reload();
            onChanged();
          }}
        />
      ) : null}

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
