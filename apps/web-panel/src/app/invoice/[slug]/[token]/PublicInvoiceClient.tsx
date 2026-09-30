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
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">فاکتور فروش شماره {toPersianDigits(invoice.invoiceNo)}</span>
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

          <div className="text-[12px] text-muted mt-2">تاریخ صدور: {formatJalaliDate(new Date(invoice.issuedAt))}</div>

          <div className="mt-5 border-t border-border pt-4 flex flex-col gap-2">
            {invoice.lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-ink-soft">
                  {l.description} × {toPersianDigits(l.quantity)}
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
                <span className="text-muted">مالیات</span>
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
