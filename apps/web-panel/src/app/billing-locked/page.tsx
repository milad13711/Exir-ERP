"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchInvoices, clearToken, ApiError, type Invoice } from "@/lib/api";

/**
 * تننتی که تریال آن تمام شده به‌جای اینکه اصلاً اجازه‌ی ورود نداشته باشد
 * (و به مشتری وانمود کند حسابش پاک شده)، وارد می‌شود اما همین صفحه را
 * می‌بیند: فاکتور معلق و راه پرداخت آن. داده‌های واقعی کسب‌وکار دست‌نخورده
 * می‌مانند، فقط تا پرداخت فاکتور در دسترس نیستند.
 */
export default function BillingLockedPage() {
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null | "none">(null);

  useEffect(() => {
    fetchInvoices()
      .then((invoices) => {
        const pending = invoices.find((inv) => inv.status === "PENDING") ?? null;
        setInvoice(pending ?? "none");
      })
      .catch((err) => {
        // اگر همین درخواست هم ۴۰۲ برگرداند یعنی توکن اصلاً معتبر نبود؛ apiFetch خودش این مسیر را دوباره به همین صفحه هدایت می‌کند، پس اینجا فقط از خطای دیگر جلوگیری می‌کنیم.
        if (!(err instanceof ApiError) || err.status !== 402) setInvoice("none");
      });
  }, []);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div dir="rtl" className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-3xl p-7 shadow-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <LogoMark className="w-4 h-4 text-white" />
          </div>
          <span className="text-[15px] font-extrabold">اکسیر ERP</span>
        </div>

        <div className="text-center mb-5">
          <div className="text-[15px] font-extrabold mb-1.5">دوره‌ی رایگان شما به پایان رسیده است</div>
          <p className="text-[12.5px] text-ink-soft leading-relaxed">
            اطلاعات و داده‌های محیط کاری شما کاملاً محفوظ است — برای ادامه‌ی استفاده، فقط لازم است فاکتور زیر پرداخت
            شود.
          </p>
        </div>

        {invoice === null ? (
          <div className="text-center text-muted text-sm py-6">در حال بارگذاری فاکتور...</div>
        ) : invoice === "none" ? (
          <div className="text-center text-[12.5px] text-ink-soft leading-relaxed py-4">
            فاکتوری برای این محیط کاری پیدا نشد — با پشتیبانی اکسیر تماس بگیرید.
          </div>
        ) : (
          <>
            <div className="bg-slate-50 border border-border rounded-2xl p-5 text-center mb-5">
              <div className="text-[11.5px] text-muted mb-1.5">مبلغ قابل پرداخت</div>
              <div className="text-2xl font-extrabold">{formatToman(invoice.amount)}</div>
              <div className="text-[11px] text-muted mt-2">مهلت پرداخت: {formatJalaliDate(invoice.dueAt)}</div>
            </div>

            <a
              href={`/pay/${invoice.id}`}
              className="w-full block text-center py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold"
            >
              پرداخت فاکتور و فعال‌سازی
            </a>
          </>
        )}

        <button
          type="button"
          onClick={handleLogout}
          className="w-full text-center mt-5 text-[12.5px] font-semibold text-muted"
        >
          خروج از حساب
        </button>
      </div>
    </div>
  );
}
