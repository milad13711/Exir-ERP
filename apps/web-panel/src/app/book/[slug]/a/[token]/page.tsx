"use client";

import { use, useEffect, useState } from "react";
import { LogoMark } from "@/components/icons";
import { formatJalaliDateTime, formatToman } from "@/lib/persian";
import {
  fetchPublicAppointmentByToken,
  startPublicAppointmentPaymentByToken,
  ApiError,
  type PublicAppointmentView,
  type AppointmentStatus,
} from "@/lib/api";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING_COORDINATION: "در انتظار هماهنگی",
  SCHEDULED: "ثبت‌شده — در انتظار تأیید",
  CONFIRMED: "تأیید شده",
  COMPLETED: "انجام شده",
  CANCELLED: "لغو شده",
  NO_SHOW: "عدم حضور",
};

/** صفحه‌ی عمومی جزئیات جلسه — لینکی که داخل پیامک رزرو می‌رود: تاریخ، ساعت، آدرس، توضیحات و پرداخت. */
export default function PublicAppointmentPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [view, setView] = useState<PublicAppointmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPublicAppointmentByToken(slug, token)
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : "این لینک یافت نشد"));
  }, [slug, token]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await startPublicAppointmentPaymentByToken(slug, token);
      if (res.paymentUrl) {
        window.location.assign(res.paymentUrl);
        return;
      }
      setError(res.error ?? "اتصال به درگاه پرداخت ناموفق بود");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "اتصال به درگاه پرداخت ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">جزئیات جلسه{view?.businessName ? ` — ${view.businessName}` : ""}</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[460px]">
          {!view ? (
            <div className="text-center text-muted py-10">{error ?? "در حال بارگذاری..."}</div>
          ) : (
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="text-lg font-extrabold mb-1">{view.customerName} عزیز</div>
              <div className="text-[13px] text-ink-soft mb-4">وضعیت رزرو: {STATUS_LABEL[view.status]}</div>

              <div className="border border-border rounded-xl overflow-hidden mb-4">
                <Row label="خدمت" value={view.serviceName} />
                <Row label="تاریخ و ساعت" value={formatJalaliDateTime(view.startAt)} />
                {view.providerName && <Row label="کارشناس" value={view.providerName} />}
                {view.location && <Row label="آدرس" value={view.location} />}
                {view.description && <Row label="توضیحات جلسه" value={view.description} />}
              </div>

              {view.paymentStatus === "PAID" && (
                <div className="border-2 border-success/30 bg-success-soft rounded-xl p-4 text-[13px]">
                  <div className="text-success font-extrabold text-center mb-2">✓ رسید تأیید رزرو</div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between"><span className="text-muted">مبلغ پرداخت‌شده</span><span className="font-bold">{formatToman(view.amount ?? 0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted">نوع پرداخت</span><span className="font-bold">{view.isFullPayment ? "پرداخت کامل" : "بیعانه"}</span></div>
                    {view.paidAt && <div className="flex justify-between"><span className="text-muted">تاریخ پرداخت</span><span className="font-bold">{formatJalaliDateTime(view.paidAt)}</span></div>}
                    {view.paymentRefId ? <div className="flex justify-between"><span className="text-muted">کد پیگیری</span><span className="font-bold" dir="ltr">{view.paymentRefId}</span></div> : null}
                  </div>
                </div>
              )}
              {view.status === "CANCELLED" && view.cancelReason && <div className="text-[12.5px] text-danger mt-3">دلیل لغو: {view.cancelReason}</div>}
              {view.paymentStatus === "PENDING" && view.amount && view.status !== "CANCELLED" && (
                <div className="flex flex-col gap-2">
                  {error && <div className="text-[12.5px] text-danger font-semibold text-center">{error}</div>}
                  <button onClick={pay} disabled={busy} className="py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold disabled:opacity-50 cursor-pointer">
                    {busy ? "در حال انتقال به درگاه..." : `پرداخت ${view.isFullPayment ? "کامل مبلغ" : "بیعانه"} — ${formatToman(view.amount)}`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex border-b border-border last:border-b-0">
      <div className="w-[110px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{label}</div>
      <div className="flex-1 text-[12.5px] px-3 py-2.5 whitespace-pre-wrap">{value}</div>
    </div>
  );
}
