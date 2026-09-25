"use client";

import { use, useEffect, useState } from "react";
import { LogoMark } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchPublicInvoice, payPublicInvoice, ApiError, type PublicInvoice } from "@/lib/api";

export default function PublicInvoicePayPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params);
  const [invoice, setInvoice] = useState<PublicInvoice | null | "not_found">(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublicInvoice(invoiceId)
      .then(setInvoice)
      .catch(() => setInvoice("not_found"));
  }, [invoiceId]);

  async function handlePay() {
    setPaying(true);
    setError(null);
    try {
      const res = await payPublicInvoice(invoiceId);
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
        return;
      }
      setError(res.error ?? "خطایی رخ داد");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-3xl p-7 shadow-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <LogoMark className="w-8 h-8" />
          <span className="text-[15px] font-extrabold">اکسیر ERP</span>
        </div>

        {invoice === null ? (
          <div className="text-center text-muted text-sm py-8">در حال بارگذاری...</div>
        ) : invoice === "not_found" ? (
          <div className="text-center text-danger text-sm py-8">فاکتور یافت نشد.</div>
        ) : (
          <>
            <div className="text-center text-[13px] text-muted mb-1">فاکتور برای</div>
            <div className="text-center text-[15px] font-bold mb-5">{invoice.tenantName}</div>

            {invoice.items && invoice.items.length > 0 ? (
              <div className="border border-border rounded-2xl overflow-hidden mb-5">
                {invoice.items.map((item) => (
                  <div
                    key={item.moduleCode}
                    className="flex items-center justify-between px-4 py-3 text-[12.5px] border-b border-border last:border-b-0"
                  >
                    <span className="font-semibold">
                      {item.moduleName}
                      <span className="text-muted font-normal">
                        {" "}
                        (
                        {item.billingMode === "MONTHLY" ? "ماهانه" : item.billingMode === "YEARLY" ? "سالانه" : "لایسنس"}
                        )
                      </span>
                    </span>
                    <span dir="ltr">{formatToman(item.amount)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="bg-slate-50 border border-border rounded-2xl p-5 text-center mb-5">
              <div className="text-[11.5px] text-muted mb-1.5">مبلغ قابل پرداخت</div>
              <div className="text-2xl font-extrabold">{formatToman(invoice.amount)}</div>
              <div className="text-[11px] text-muted mt-2">مهلت پرداخت: {formatJalaliDate(invoice.dueAt)}</div>
            </div>

            {invoice.status === "PAID" ? (
              <div className="text-center text-success text-[13px] font-bold py-3">
                این فاکتور قبلاً پرداخت شده است ✓
              </div>
            ) : !invoice.gatewayAvailable ? (
              <div className="text-center text-[12.5px] text-muted leading-relaxed py-3">
                درگاه پرداخت آنلاین در دسترس نیست — برای پرداخت با پشتیبانی اکسیر تماس بگیرید.
              </div>
            ) : (
              <>
                {error ? <div className="text-[12px] text-danger text-center mb-3">{error}</div> : null}
                <button
                  onClick={handlePay}
                  disabled={paying}
                  className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold cursor-pointer disabled:opacity-50"
                >
                  {paying ? "در حال انتقال به درگاه..." : "پرداخت آنلاین (زرین‌پال)"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
