"use client";

import { use, useEffect, useState } from "react";
import { LogoMark } from "@/components/icons";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { formatJalaliDateTime, formatToman } from "@/lib/persian";
import {
  fetchProviderAppointment,
  fetchProviderSlots,
  providerConfirmAppointment,
  providerRejectAppointment,
  providerRescheduleAppointment,
  ApiError,
  type ProviderAppointmentView,
  type AppointmentStatus,
} from "@/lib/api";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING_COORDINATION: "در انتظار هماهنگی شما",
  SCHEDULED: "ثبت‌شده — در انتظار تأیید شما",
  CONFIRMED: "تأیید شده",
  COMPLETED: "انجام شده",
  CANCELLED: "لغو شده",
  NO_SHOW: "عدم حضور",
};

/** لینک خصوصی متخصص (داخل پیامک رزرو): اطلاعات و شماره‌ی متقاضی، تماس، تأیید، رد با دلیل، جابه‌جایی به وقت آزاد. */
export default function ProviderAppointmentPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [view, setView] = useState<ProviderAppointmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "reject" | "reschedule">("none");
  const [reason, setReason] = useState("");
  const [newStart, setNewStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function reload() {
    fetchProviderAppointment(slug, token)
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : "این لینک یافت نشد"));
  }
  useEffect(reload, [slug, token]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setNotice(done);
      setMode("none");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <LogoMark className="w-5 h-5 text-primary" />
          </div>
          <span className="font-extrabold">رزرو جدید — پنل متخصص</span>
        </div>
      </div>
      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[460px]">
          {!view ? (
            <div className="text-center text-muted py-10">{error ?? "در حال بارگذاری..."}</div>
          ) : (
            <div className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-4">
              <div className="text-[13px] text-ink-soft">وضعیت: <b>{STATUS_LABEL[view.status]}</b></div>
              <div className="border border-border rounded-xl overflow-hidden">
                <Row label="متقاضی" value={view.customerName} />
                <div className="flex border-b border-border">
                  <div className="w-[110px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">شماره تماس</div>
                  <div className="flex-1 text-[13px] px-3 py-2.5 flex items-center justify-between gap-2">
                    <span dir="ltr">{view.customerPhone ?? "—"}</span>
                    {view.customerPhone && (
                      <a href={`tel:${view.customerPhone}`} className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg">
                        تماس
                      </a>
                    )}
                  </div>
                </div>
                <Row label="خدمت" value={view.serviceName} />
                <Row label="تاریخ و ساعت" value={formatJalaliDateTime(view.startAt)} />
                {view.location && <Row label="آدرس" value={view.location} />}
                {view.notes && <Row label="توضیحات متقاضی" value={view.notes} />}
                <Row
                  label="پرداخت"
                  value={view.paymentStatus === "PAID" ? `پرداخت شده (${view.isFullPayment ? "کامل" : "بیعانه"} ${formatToman(view.amount ?? 0)})` : view.paymentStatus === "PENDING" ? "در انتظار پرداخت" : "بدون پرداخت"}
                />
                {view.status === "CANCELLED" && view.cancelReason && <Row label="دلیل لغو" value={view.cancelReason} />}
              </div>

              {notice && <div className="text-[13px] text-success font-semibold text-center">{notice}</div>}
              {error && <div className="text-[12.5px] text-danger font-semibold text-center">{error}</div>}

              {view.canAct && mode === "none" && (
                <div className="grid grid-cols-3 gap-2">
                  <button disabled={busy} onClick={() => run(() => providerConfirmAppointment(slug, token), "رزرو تأیید شد و مشتری مطلع شد.")} className="py-3 rounded-xl bg-success text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                    تأیید
                  </button>
                  <button disabled={busy} onClick={() => setMode("reschedule")} className="py-3 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                    جابه‌جایی
                  </button>
                  <button disabled={busy} onClick={() => setMode("reject")} className="py-3 rounded-xl bg-danger-soft text-danger text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                    رد
                  </button>
                </div>
              )}

              {mode === "reject" && (
                <div className="flex flex-col gap-2">
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="دلیل رد (برای مشتری ارسال می‌شود)" className="w-full text-[13px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3" />
                  <div className="flex gap-2">
                    <button disabled={busy || reason.trim().length < 2} onClick={() => run(() => providerRejectAppointment(slug, token, reason), "رزرو رد شد و دلیل برای مشتری پیامک شد.")} className="flex-1 py-3 rounded-xl bg-danger text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                      ثبت رد
                    </button>
                    <button onClick={() => setMode("none")} className="flex-1 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">
                      انصراف
                    </button>
                  </div>
                </div>
              )}

              {mode === "reschedule" && (
                <div className="flex flex-col gap-3">
                  <SlotPicker loadSlots={(d) => fetchProviderSlots(slug, token, d)} value={newStart} onChange={setNewStart} />
                  <div className="flex gap-2">
                    <button disabled={busy || !newStart} onClick={() => run(() => providerRescheduleAppointment(slug, token, newStart), "زمان جدید ثبت و برای مشتری پیامک شد.")} className="flex-1 py-3 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                      ثبت زمان جدید
                    </button>
                    <button onClick={() => setMode("none")} className="flex-1 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">
                      انصراف
                    </button>
                  </div>
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
