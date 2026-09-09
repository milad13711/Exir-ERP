"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, TicketIcon, ShareIcon, WhatsAppIcon } from "@/components/icons";
import { formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import { copyToClipboard } from "@/lib/clipboard";
import {
  publicEventCoverImageUrl,
  requestPublicEventOtp,
  verifyPublicEventOtp,
  createPublicEventOrder,
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
  // شمار بلیط انتخابی به تفکیک نوع — امکان خرید هم‌زمان چند نوع بلیط (مثلاً عادی + ویژه) در یک سفارش
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [bookingToken, setBookingToken] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [attendeesByType, setAttendeesByType] = useState<Record<string, Attendee[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const notYetOpen = registrationStatus === "not_open";
  const closed = registrationStatus === "closed";
  const soldOut = event.remainingCapacity != null && event.remainingCapacity <= 0;
  const cartQuantity = Object.values(cart).reduce((sum, n) => sum + n, 0);
  const canRegister = !notYetOpen && !closed && !soldOut && event.ticketTypes.length > 0;

  function setCartQuantity(ticketTypeId: string, quantity: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[ticketTypeId];
      else next[ticketTypeId] = quantity;
      return next;
    });
  }

  function startBooking() {
    if (cartQuantity < 1) {
      setError("حداقل یک بلیط انتخاب کنید");
      return;
    }
    // فیلدهای شرکت‌کننده را متناسب با تعداد هر نوع بلیط آماده می‌کند
    setAttendeesByType(
      Object.fromEntries(Object.entries(cart).map(([ticketTypeId, qty]) => [ticketTypeId, Array.from({ length: qty }, () => ({ name: "", phone: "" }))])),
    );
    setStep("phone");
    setError(null);
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
      setAttendeesByType((prev) => {
        const entries = Object.entries(prev);
        if (entries.length === 0) return prev;
        const [firstType, list] = entries[0];
        if (list.length === 0 || list[0].phone) return prev;
        return { ...prev, [firstType]: list.map((a, i) => (i === 0 ? { ...a, phone } : a)) };
      });
      setStep("details");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "کد تأیید نادرست است");
    }
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    const allAttendees = Object.values(attendeesByType).flat();
    if (!buyerName.trim() || allAttendees.some((a) => !a.name.trim())) {
      setError("لطفاً نام همه‌ی شرکت‌کنندگان را وارد کنید");
      return;
    }
    setError(null);
    setStep("submitting");
    try {
      const res = await createPublicEventOrder(tenantSlug, event.slug, {
        bookingToken,
        buyerName: buyerName.trim(),
        items: Object.entries(attendeesByType).map(([ticketTypeId, attendees]) => ({
          ticketTypeId,
          attendees: attendees.map((a) => ({ name: a.name.trim(), phone: a.phone.trim() || undefined })),
        })),
      });
      if (res.requiresPayment) {
        const pay = await payPublicEventBooking(tenantSlug, res.orderGroupId);
        if (pay.paymentUrl) {
          window.location.href = pay.paymentUrl;
          return;
        }
        setError(pay.error ?? "اتصال به درگاه پرداخت ناموفق بود");
        setStep("details");
      } else {
        router.push(`/events/${tenantSlug}/bookings/${res.orderGroupId}`);
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
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // کاربر خودش انصراف داد
        // بقیه‌ی خطاها (مثلاً navigator.share در دسترس نیست) به کپی لینک برمی‌گردد
      }
    }
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } else {
      setError("کپی لینک ناموفق بود");
    }
  }

  const total = Object.entries(cart).reduce((sum, [ticketTypeId, qty]) => {
    const t = event.ticketTypes.find((tt) => tt.id === ticketTypeId);
    return sum + (t ? t.price * qty : 0);
  }, 0);

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

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={share}
              title="اشتراک‌گذاری"
              className="w-9 h-9 flex items-center justify-center text-primary border border-border rounded-lg cursor-pointer"
            >
              <ShareIcon className="w-4 h-4" />
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${event.title} — ${shareUrl}`)}`}
              target="_blank"
              rel="noreferrer"
              title="ارسال در واتس‌اپ"
              className="w-9 h-9 flex items-center justify-center text-[#25D366] border border-border rounded-lg"
            >
              <WhatsAppIcon className="w-4.5 h-4.5" />
            </a>
            {shareCopied && <span className="text-[11.5px] text-success font-semibold">لینک کپی شد</span>}
          </div>

          {event.description && <p className="text-[13.5px] text-ink-soft leading-relaxed mt-5 whitespace-pre-wrap">{event.description}</p>}

          <div className="mt-6 border-t border-border pt-5">
            {step === "closed" && (
              <>
                <div className="flex flex-col gap-2 mb-4">
                  {event.ticketTypes.map((t) => {
                    const qty = cart[t.id] ?? 0;
                    const maxAvailable = t.remaining ?? Infinity;
                    return (
                      <div key={t.id} className="flex items-center justify-between border border-border rounded-xl px-4 py-3 gap-3">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-bold">{t.name}</div>
                          {t.remaining != null && <div className="text-[11.5px] text-muted mt-0.5">{toPersianDigits(t.remaining)} جای خالی</div>}
                          <div className="text-[13px] font-extrabold text-primary mt-1">{t.price === 0 ? "رایگان" : formatToman(t.price)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setCartQuantity(t.id, Math.max(0, qty - 1))}
                            disabled={qty === 0}
                            className="w-8 h-8 rounded-lg border border-border font-bold cursor-pointer disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="text-[13.5px] font-bold w-5 text-center">{toPersianDigits(qty)}</span>
                          <button
                            type="button"
                            onClick={() => setCartQuantity(t.id, Math.min(maxAvailable, qty + 1))}
                            disabled={qty >= maxAvailable}
                            className="w-8 h-8 rounded-lg border border-border font-bold cursor-pointer disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!canRegister ? (
                  <div className="text-center text-[13px] font-bold text-muted bg-slate-50 rounded-xl py-3.5">
                    {soldOut ? "ظرفیت این رویداد تکمیل شده است" : closed ? "مهلت ثبت‌نام به پایان رسیده است" : "ثبت‌نام هنوز شروع نشده است"}
                  </div>
                ) : (
                  <>
                    {error && <div className="text-[12.5px] text-danger font-semibold mb-2 text-center">{error}</div>}
                    <button
                      onClick={startBooking}
                      className="w-full py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer flex items-center justify-center gap-2"
                    >
                      ثبت‌نام و خرید بلیط
                      {cartQuantity > 0 && <span className="bg-white/20 rounded-full px-2 py-0.5 text-[12px]">{toPersianDigits(cartQuantity)}</span>}
                    </button>
                  </>
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
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نام و نام خانوادگی خریدار</label>
                  <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputClass} />
                </div>

                {Object.entries(attendeesByType).map(([ticketTypeId, list]) => {
                  const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
                  return (
                    <div key={ticketTypeId} className="flex flex-col gap-2.5">
                      <label className="text-[12px] font-semibold text-ink-soft">شرکت‌کنندگان بلیط {ticketType?.name}</label>
                      {list.map((a, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            value={a.name}
                            onChange={(e) =>
                              setAttendeesByType((prev) => ({
                                ...prev,
                                [ticketTypeId]: prev[ticketTypeId].map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                              }))
                            }
                            placeholder={`نام شرکت‌کننده ${toPersianDigits(i + 1)}`}
                            className={inputClass}
                          />
                          <input
                            value={a.phone}
                            onChange={(e) =>
                              setAttendeesByType((prev) => ({
                                ...prev,
                                [ticketTypeId]: prev[ticketTypeId].map((p, j) => (j === i ? { ...p, phone: e.target.value.replace(/[^0-9]/g, "") } : p)),
                              }))
                            }
                            dir="ltr"
                            placeholder="موبایل (اختیاری)"
                            className={`${inputClass} max-w-[140px]`}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}

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
