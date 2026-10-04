"use client";

import { useState } from "react";
import { LogoMark, ReceiptIcon } from "@/components/icons";
import { formatJalaliDate, formatToman, toPersianDigits } from "@/lib/persian";
import { payPublicSalesInvoice, ApiError, type PublicSalesInvoiceView } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  CONFIRMED: "تأییدشده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
  CANCELLED: "باطل‌شده",
};
const METHOD_LABELS: Record<string, string> = {
  CASH: "نقدی",
  BANK_TRANSFER: "انتقال بانکی",
  CHECK: "چک",
  POS: "کارت‌خوان",
  ONLINE_GATEWAY: "پرداخت آنلاین",
};
const INVOICE_PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "کارت/حساب بانکی",
  ONLINE_GATEWAY: "درگاه پرداخت آنلاین",
  CASH: "نقدی",
  CHECK: "چکی",
};

export function PublicInvoiceClient({ tenantSlug, token, invoice }: { tenantSlug: string; token: string; invoice: PublicSalesInvoiceView }) {
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = invoice.total - invoice.paidAmount;
  const dayMs = 24 * 3600 * 1000;
  const [now] = useState(() => Date.now());
  const dueMs = invoice.dueAt ? new Date(invoice.dueAt).getTime() : null;
  const open = remaining > 0 && invoice.status !== "CANCELLED" && invoice.status !== "DRAFT";
  const overdue = open && dueMs !== null && dueMs < now;
  const overdueDays = overdue && dueMs !== null ? Math.max(1, Math.floor((now - dueMs) / dayMs)) : 0;
  const daysLeft = dueMs !== null ? Math.max(0, Math.ceil((dueMs - now) / dayMs)) : null;

  async function handlePay() {
    setPaying(true);
    setError(null);
    try {
      const res = await payPublicSalesInvoice(tenantSlug, token);
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
        return;
      }
      setError(res.error ?? "اتصال به درگاه پرداخت ناموفق بود");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[560px] mx-auto flex items-center gap-2.5 px-6 py-4">
          {invoice.seller.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invoice.seller.logoUrl} alt="" className="w-9 h-9 rounded-lg object-contain" />
          ) : (
            <LogoMark className="w-9 h-9" />
          )}
          <div className="flex flex-col leading-tight">
            {invoice.seller.name ? <span className="text-[11.5px] text-muted">{invoice.seller.name}</span> : null}
            <span className="font-extrabold">فاکتور فروش شماره {toPersianDigits(invoice.invoiceNo)}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-8">
        <div className="max-w-[560px] mx-auto bg-white rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-muted">مشتری</div>
              <div className="text-[14px] font-bold mt-0.5">{invoice.contact.company || invoice.contact.name}</div>
            </div>
            <div className="text-[12px] font-bold bg-slate-100 rounded-full px-3 py-1.5">{STATUS_LABELS[invoice.status]}</div>
          </div>

          {invoice.contact.phoneMasked ? <div className="text-[12px] text-muted mt-1" dir="ltr" style={{ textAlign: "right" }}>{toPersianDigits(invoice.contact.phoneMasked)}</div> : null}

          {invoice.status === "CANCELLED" && (
            <div className="mt-3 text-[12.5px] bg-danger-soft text-danger rounded-lg px-3 py-2 font-semibold">
              این فاکتور باطل شده است{invoice.cancelReason ? ` — ${invoice.cancelReason}` : ""}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <div className="text-muted">تاریخ صدور</div>
              <div className="font-bold mt-0.5">{formatJalaliDate(new Date(invoice.issuedAt))}</div>
            </div>
            <div className={`rounded-lg px-3 py-2 ${overdue ? "bg-danger-soft text-danger" : "bg-slate-50"}`}>
              <div className={overdue ? "" : "text-muted"}>تاریخ سررسید</div>
              <div className="font-bold mt-0.5">
                {invoice.dueAt ? formatJalaliDate(new Date(invoice.dueAt)) : "—"}
                {overdue ? ` (${toPersianDigits(overdueDays)} روز گذشته)` : daysLeft !== null && remaining > 0 && invoice.status !== "CANCELLED" ? ` (${toPersianDigits(daysLeft)} روز مانده)` : ""}
              </div>
            </div>
            {invoice.isOfficial && (
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="text-muted">نوع فاکتور</div>
                <div className="font-bold mt-0.5">
                  رسمی{invoice.officialInvoiceNo ? ` — شماره ${toPersianDigits(invoice.officialInvoiceNo)}` : ""}
                </div>
              </div>
            )}
            {invoice.signedAt && (
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="text-muted">امضا</div>
                <div className="font-bold mt-0.5">
                  {invoice.signedByName ? `${invoice.signedByName} — ` : ""}
                  {formatJalaliDate(new Date(invoice.signedAt))}
                </div>
              </div>
            )}
            {invoice.deliveryConfirmedAt && (
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="text-muted">تحویل کالا</div>
                <div className="font-bold mt-0.5">تأیید شده — {formatJalaliDate(new Date(invoice.deliveryConfirmedAt))}</div>
              </div>
            )}
          </div>

          {invoice.notes && (
            <div className="mt-3 text-[12.5px] text-ink-soft bg-warning-soft/40 border border-border rounded-lg px-3 py-2.5 leading-6">
              <div className="text-[11px] font-bold text-muted mb-0.5">یادداشت</div>
              <div className="whitespace-pre-wrap">{invoice.notes}</div>
            </div>
          )}

          <div className="mt-5 border-t border-border pt-4 flex flex-col gap-2">
            {invoice.lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-ink-soft">
                  {l.description} × {toPersianDigits(l.quantity)}
                  <span className="text-[11px] text-muted"> (هر واحد {formatToman(l.unitPrice)})</span>
                </span>
                <span className="font-bold">{formatToman(l.lineTotal)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-border pt-4 flex flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted">جمع اقلام</span>
              <span>{formatToman(invoice.subtotal)}</span>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">تخفیف</span>
                <span>{formatToman(invoice.discount)}</span>
              </div>
            )}
            {invoice.taxAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">مالیات{invoice.taxRate ? ` (${toPersianDigits(invoice.taxRate)}٪)` : ""}</span>
                <span>{formatToman(invoice.taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[15px] font-extrabold mt-1">
              <span>مبلغ کل</span>
              <span>{formatToman(invoice.total)}</span>
            </div>
            {invoice.paidAmount > 0 && (
              <div className="flex justify-between text-success font-bold">
                <span>پرداخت‌شده</span>
                <span>{formatToman(invoice.paidAmount)}</span>
              </div>
            )}
            {remaining > 0 && (
              <div className="flex justify-between text-danger font-bold">
                <span>باقی‌مانده</span>
                <span>{formatToman(remaining)}</span>
              </div>
            )}
          </div>

          {invoice.payments.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="text-[12px] font-bold text-ink-soft mb-2 flex items-center gap-1.5">
                <ReceiptIcon className="w-3.5 h-3.5" /> تاریخچه‌ی پرداخت
              </div>
              <div className="flex flex-col gap-1.5">
                {invoice.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-[12.5px] bg-slate-50 rounded-lg px-3 py-2">
                    <span className="text-muted">
                      {METHOD_LABELS[p.method] ?? p.method} — {formatJalaliDate(new Date(p.paidAt))}
                    </span>
                    <span className="font-bold">{formatToman(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-border pt-4">
            <div className="text-[12px] font-bold text-ink-soft mb-1.5">روش پرداخت</div>
            <div className="bg-primary-soft text-primary text-[12.5px] font-bold rounded-lg px-3 py-2 w-fit">
              {INVOICE_PAYMENT_METHOD_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod}
            </div>
            {invoice.paymentBankInfo && (
              <div className="text-[12.5px] font-bold bg-slate-50 border border-border rounded-lg px-3 py-2 mt-2 leading-6 whitespace-pre-wrap" dir="auto">
                {invoice.paymentBankInfo}
              </div>
            )}
            {invoice.paymentInstruction && (
              <div className="text-[12px] text-ink-soft bg-slate-50 border border-border rounded-lg px-3 py-2 mt-2 leading-6">
                {invoice.paymentInstruction}
              </div>
            )}
          </div>

          {invoice.canPayOnline && invoice.gatewayAvailable && (
            <div className="mt-6">
              {error && <div className="text-[12.5px] text-danger font-semibold mb-2 text-center">{error}</div>}
              <button onClick={handlePay} disabled={paying} className="w-full py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer disabled:opacity-50">
                {paying ? "در حال اتصال به درگاه..." : `پرداخت آنلاین ${formatToman(remaining)}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
