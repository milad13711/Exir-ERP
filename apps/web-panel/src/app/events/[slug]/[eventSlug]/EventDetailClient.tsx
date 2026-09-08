"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, TicketIcon } from "@/components/icons";
import { formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import {
  publicEventCoverImageUrl,
  requestPublicEventOtp,
  verifyPublicEventOtp,
  createPublicEventBooking,
  payPublicEventBooking,
  ApiError,
  type PublicEventItem,
} from "@/lib/api";

const inputClass =
  "w-full text-[13.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-4 py-3 focus:border-primary transition-colors";

type Attendee = { name: string; phone: string };
type Step = "closed" | "phone" | "otp" | "details" | "submitting";

type RegistrationStatus = "open" | "not_open" | "closed";

export function EventDetailClient({
  tenantSlug,
  event,
  shareUrl,
  registrationStatus,
}: {
  tenantSlug: string;
  event: PublicEventItem;
  shareUrl: string;
  registrationStatus: RegistrationStatus;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");
  const [ticketTypeId, setTicketTypeId] = useState(event.ticketTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [bookingToken, setBookingToken] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [attendees, setAttendees] = useState<Attendee[]>([{ name: "", phone: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const notYetOpen = registrationStatus === "not_open";
  const closed = registrationStatus === "closed";
  const soldOut = event.remainingCapacity != null && event.remainingCapacity <= 0;
  const canRegister = !notYetOpen && !closed && !soldOut && event.ticketTypes.length > 0;

  function startBooking() {
    setStep("phone");
    setError(null);
  }

  function setAttendeeCount(n: number) {
    setQuantity(n);
    setAttendees((prev) => {
      const next = [...prev];
      while (next.length < n) next.push({ name: "", phone: "" });
      return next.slice(0, n);
    });
  }

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!/^09\d{9}$/.test(phone)) {
      setError("شماره موبایل معتبر نیست");
      return;
    }
    setError(null);
    try {
      const res = await requestPublicEventOtp(tenantSlug, phone);
      setDevCode(res.devCode ?? null);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارسال کد ناموفق بود");
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await verifyPublicEventOtp(tenantSlug, phone, code);
      setBookingToken(res.bookingToken);
      setAttendees((prev) => prev.map((a, i) => (i === 0 && !a.phone ? { ...a, phone } : a)));
      setStep("details");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "کد تأیید نادرست است");
    }
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!buyerName.trim() || attendees.some((a) => !a.name.trim())) {
      setError("لطفاً نام همه‌ی شرکت‌کنندگان را وارد کنید");
      return;
    }
    setError(null);
    setStep("submitting");
    try {
      const res = await createPublicEventBooking(tenantSlug, event.slug, {
        bookingToken,
        ticketTypeId,
        buyerName: buyerName.trim(),
        attendees: attendees.map((a) => ({ name: a.name.trim(), phone: a.phone.trim() || undefined })),
      });
      if (res.requiresPayment) {
        const pay = await payPublicEventBooking(tenantSlug, res.bookingId);
        if (pay.paymentUrl) {
          window.location.href = pay.paymentUrl;
          return;
        }
        setError(pay.error ?? "اتصال به درگاه پرداخت ناموفق بود");
        setStep("details");
      } else {
        router.push(`/events/${tenantSlug}/bookings/${res.bookingId}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت‌نام ناموفق بود");
      setStep("details");
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: event.title, url: shareUrl });
        return;
      } catch {
        /* کاربر انصراف داد */
      }
    }
    await navigator.clipboard.writeText(shareUrl);
    alert("لینک رویداد کپی شد");
  }

  const selectedType = event.ticketTypes.find((t) => t.id === ticketTypeId);
  const total = selectedType ? selectedType.price * quantity : 0;

  return (
    <div dir="rtl" className="min-h-dvh bg-white">
      <div className="h-64 sm:h-80 bg-primary-soft relative overflow-hidden">
        {event.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={publicEventCoverImageUrl(tenantSlug, event.slug)} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-primary">
            <TicketIcon className="w-14 h-14" />
          </div>
        )}
      </div>

      <div className="max-w-[720px] mx-auto px-5 -mt-10 relative">
        <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-7">
          <h1 className="text-xl sm:text-2xl font-extrabold">{event.title}</h1>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-[13px] text-ink-soft">
            <div className="flex items-center gap-1.5">
              <CalendarIcon className="w-4 h-4 text-primary" />
              {formatJalaliDateTime(event.startAt)}
            </div>
            {event.venue && <div>📍 {event.venue}</div>}
            {event.isOnline && <div>🌐 برگزاری آنلاین</div>}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button onClick={share} className="text-[12px] font-bold text-primary border border-border rounded-lg px-3 py-1.5 cursor-pointer">
              اشتراک‌گذاری
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${event.title} — ${shareUrl}`)}`}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] font-bold text-primary border border-border rounded-lg px-3 py-1.5"
            >
              ارسال در واتس‌اپ
            </a>
          </div>

          {event.description && <p className="text-[13.5px] text-ink-soft leading-relaxed mt-5 whitespace-pre-wrap">{event.description}</p>}

          <div className="mt-6 border-t border-border pt-5">
            {step === "closed" && (
              <>
                <div className="flex flex-col gap-2 mb-4">
                  {event.ticketTypes.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border border-border rounded-xl px-4 py-3">
                      <div>
                        <div className="text-[13.5px] font-bold">{t.name}</div>
                        {t.remaining != null && <div className="text-[11.5px] text-muted mt-0.5">{toPersianDigits(t.remaining)} جای خالی</div>}
                      </div>
                      <div className="text-[13.5px] font-extrabold text-primary">{t.price === 0 ? "رایگان" : formatToman(t.price)}</div>
                    </div>
                  ))}
                </div>
                {!canRegister ? (
                  <div className="text-center text-[13px] font-bold text-muted bg-slate-50 rounded-xl py-3.5">
                    {soldOut ? "ظرفیت این رویداد تکمیل شده است" : closed ? "مهلت ثبت‌نام به پایان رسیده است" : "ثبت‌نام هنوز شروع نشده است"}
                  </div>
                ) : (
                  <button onClick={startBooking} className="w-full py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer">
                    ثبت‌نام و خرید بلیط
                  </button>
                )}
              </>
            )}

            {step === "phone" && (
              <form onSubmit={submitPhone} className="flex flex-col gap-3">
                <div className="text-[13.5px] font-bold">شماره موبایل خود را وارد کنید</div>
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))} dir="ltr" placeholder="09xxxxxxxxx" className={inputClass} />
                {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
                <button type="submit" className="py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer">
                  دریافت کد تأیید
                </button>
              </form>
            )}

            {step === "otp" && (
              <form onSubmit={submitOtp} className="flex flex-col gap-3">
                <div className="text-[13.5px] font-bold">کد ۴ رقمی ارسال‌شده را وارد کنید</div>
                {devCode && <div className="text-[12px] text-warning">(محیط آزمایشی) کد: {devCode}</div>}
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} dir="ltr" maxLength={4} placeholder="----" className={`${inputClass} text-center tracking-[8px]`} />
                {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
                <button type="submit" className="py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer">
                  تأیید کد
                </button>
              </form>
            )}

            {(step === "details" || step === "submitting") && (
              <form onSubmit={submitBooking} className="flex flex-col gap-3.5">
                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نوع بلیط</label>
                  <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} className={inputClass}>
                    {event.ticketTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.price === 0 ? "رایگان" : formatToman(t.price)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تعداد</label>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setAttendeeCount(Math.max(1, quantity - 1))} className="w-9 h-9 rounded-lg border border-border font-bold cursor-pointer">
                      −
                    </button>
                    <span className="text-[14px] font-bold w-6 text-center">{toPersianDigits(quantity)}</span>
                    <button type="button" onClick={() => setAttendeeCount(quantity + 1)} className="w-9 h-9 rounded-lg border border-border font-bold cursor-pointer">
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نام و نام خانوادگی خریدار</label>
                  <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputClass} />
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-[12px] font-semibold text-ink-soft">مشخصات شرکت‌کنندگان</label>
                  {attendees.map((a, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={a.name}
                        onChange={(e) => setAttendees((prev) => prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))}
                        placeholder={`نام شرکت‌کننده ${toPersianDigits(i + 1)}`}
                        className={inputClass}
                      />
                      <input
                        value={a.phone}
                        onChange={(e) => setAttendees((prev) => prev.map((p, j) => (j === i ? { ...p, phone: e.target.value.replace(/[^0-9]/g, "") } : p)))}
                        dir="ltr"
                        placeholder="موبایل (اختیاری)"
                        className={`${inputClass} max-w-[140px]`}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-border pt-3.5">
                  <span className="text-[13px] text-muted">مبلغ قابل پرداخت</span>
                  <span className="text-[16px] font-extrabold text-primary">{total === 0 ? "رایگان" : formatToman(total)}</span>
                </div>

                {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

                <button type="submit" disabled={step === "submitting"} className="py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer disabled:opacity-50">
                  {step === "submitting" ? "در حال ثبت..." : total === 0 ? "دریافت بلیط رایگان" : "پرداخت و دریافت بلیط"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
