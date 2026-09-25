"use client";

import { use, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LogoMark, CheckIcon } from "@/components/icons";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { toPersianDigits, formatToman } from "@/lib/persian";
import {
  fetchPublicServiceTypes,
  fetchPublicFreeSlots,
  fetchPublicBookingInfo,
  type PublicBookingInfo,
  fetchPublicProviders,
  requestBookingOtp,
  verifyBookingOtp,
  createPublicAppointment,
  startPublicAppointmentPayment,
  ApiError,
  type PublicServiceType,
  type PublicProvider,
} from "@/lib/api";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

type Step = "service" | "details" | "phone" | "otp" | "confirm" | "done" | "unavailable";

export default function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [step, setStep] = useState<Step>("service");

  const [serviceTypes, setServiceTypes] = useState<PublicServiceType[] | null>(null);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [selectedService, setSelectedService] = useState<PublicServiceType | null>(null);

  const [providerUserId, setProviderUserId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [notes, setNotes] = useState("");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [bookingToken, setBookingToken] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<PublicBookingInfo | null>(null);

  useEffect(() => {
    fetchPublicServiceTypes(slug)
      .then(setServiceTypes)
      .catch(() => setStep("unavailable"));
    fetchPublicBookingInfo(slug).then(setInfo).catch(() => setInfo(null));
    fetchPublicProviders(slug)
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [slug]);

  useEffect(() => {
    if (step !== "otp" || secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, secondsLeft]);

  function chooseService(s: PublicServiceType) {
    setSelectedService(s);
    setStep("details");
  }

  function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startAt) return;
    setError(null);
    setStep("phone");
  }

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestBookingOtp(slug, phone.trim());
      setDevCode(res.devCode ?? null);
      setStep("otp");
      setSecondsLeft(RESEND_SECONDS);
      setOtp(Array(OTP_LENGTH).fill(""));
      setTimeout(() => inputsRef.current[0]?.focus(), 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارسال کد با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phone.trim().length < 10) return;
    sendOtp();
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < OTP_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) inputsRef.current[index - 1]?.focus();
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await verifyBookingOtp(slug, phone.trim(), otp.join(""));
      setBookingToken(res.bookingToken);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bookingToken || !selectedService || !customerName.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const appointment = await createPublicAppointment(slug, {
        bookingToken,
        serviceTypeId: selectedService.id,
        providerUserId: providerUserId || undefined,
        customerName: customerName.trim(),
        startAt,
        notes: notes.trim() || undefined,
      });

      if (appointment.paymentStatus === "PENDING") {
        const res = await startPublicAppointmentPayment(slug, appointment.id);
        if (res.paymentUrl) {
          window.location.href = res.paymentUrl;
          return;
        }
        setError(res.error ?? "اتصال به درگاه پرداخت ناموفق بود");
        return;
      }

      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت نوبت با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const payment = selectedService
    ? selectedService.requiresFullPayment && selectedService.price > 0
      ? { isFull: true, amount: selectedService.price }
      : selectedService.requiresDeposit && (selectedService.depositAmount ?? 0) > 0
        ? { isFull: false, amount: selectedService.depositAmount ?? 0 }
        : null
    : null;

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[560px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">رزرو نوبت آنلاین{info?.businessName ? ` — ${info.businessName}` : ""}</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[520px]">
          {step !== "unavailable" && (selectedService?.location || info?.address) && (
            <div className="mb-5 flex items-start gap-2 bg-white border border-border rounded-xl px-4 py-3 text-[12.5px] leading-6">
              <span className="font-bold shrink-0">آدرس محل برگزاری:</span>
              <span>{selectedService?.location || info?.address}</span>
            </div>
          )}
          {step === "unavailable" && (
            <div className="text-center py-16">
              <div className="text-lg font-extrabold mb-2">این لینک در دسترس نیست</div>
              <p className="text-[13.5px] text-ink-soft">ممکن است رزرو آنلاین برای این کسب‌وکار فعال نباشد.</p>
            </div>
          )}

          {step === "service" && (
            <div>
              <div className="text-xl font-extrabold mb-1.5 text-center">خدمت مورد نظر را انتخاب کنید</div>
              {serviceTypes === null ? (
                <div className="text-center text-muted text-sm py-10">در حال بارگذاری...</div>
              ) : serviceTypes.length === 0 ? (
                <div className="text-center text-muted text-sm py-10">در حال حاضر خدمتی برای رزرو موجود نیست</div>
              ) : (
                <div className="flex flex-col gap-2.5 mt-6">
                  {serviceTypes.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => chooseService(s)}
                      className="text-right p-4 rounded-2xl bg-white border-2 border-border hover:border-primary transition-colors flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-[14px] font-bold">{s.name}</div>
                        <div className="text-[12px] text-muted mt-0.5">{toPersianDigits(s.durationMinutes)} دقیقه</div>
                      </div>
                      <div className="text-[13px] font-extrabold text-primary shrink-0">{formatToman(s.price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "details" && selectedService && (
            <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-4">
              <div className="text-xl font-extrabold mb-1">زمان رزرو</div>
              <div className="text-[13px] text-ink-soft -mt-2 mb-2">
                خدمت انتخابی: <span className="font-bold text-ink">{selectedService.name}</span>
              </div>
              {selectedService.requiresCoordination && (
                <div className="text-[12.5px] text-warning bg-warning-soft rounded-xl p-3 -mt-1">
                  این خدمت نیاز به هماهنگی اولیه دارد — زمان پیشنهادی خود را وارد کنید؛ پس از تأیید کارشناس، زمان نهایی به شما پیامک می‌شود.
                </div>
              )}
              {selectedService.description && (
                <div className="text-[12.5px] text-ink-soft bg-white border border-border rounded-xl p-3 -mt-1 leading-6 whitespace-pre-wrap">{selectedService.description}</div>
              )}
              {selectedService.requiresFullPayment && (
                <div className="text-[12.5px] text-primary bg-primary-soft rounded-xl p-3 -mt-1">
                  پرداخت کامل مبلغ خدمت ({formatToman(selectedService.price)}) هنگام رزرو در درگاه پرداخت انجام می‌شود؛ لینک پرداخت پیامک هم می‌شود.
                </div>
              )}
              {selectedService.requiresDeposit && !selectedService.requiresFullPayment && (
                <div className="text-[12.5px] text-primary bg-primary-soft rounded-xl p-3 -mt-1">
                  این خدمت نیاز به پرداخت بیعانه‌ی {formatToman(selectedService.depositAmount ?? 0)} دارد.
                </div>
              )}

              {providers.length > 0 && (
                <div>
                  <label className="block text-[13px] font-semibold mb-1.5">کارشناس مورد نظر (اختیاری)</label>
                  <select
                    value={providerUserId}
                    onChange={(e) => setProviderUserId(e.target.value)}
                    className="w-full text-[13.5px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
                  >
                    <option value="">بدون ترجیح</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-semibold mb-1.5">وقت آزاد را انتخاب کنید</label>
                <SlotPicker
                  loadSlots={(d) => fetchPublicFreeSlots(slug, selectedService.id, providerUserId || undefined, d)}
                  value={startAt}
                  onChange={setStartAt}
                  refreshKey={`${selectedService.id}:${providerUserId}`}
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold mb-1.5">توضیحات اضافه (اختیاری)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full text-[13.5px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
                />
              </div>

              {error && <div className="text-[13px] text-danger font-semibold">{error}</div>}

              <button
                type="submit"
                disabled={!startAt}
                className="py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-40"
              >
                ادامه
              </button>
              <button type="button" onClick={() => setStep("service")} className="text-center text-[12.5px] font-semibold text-muted">
                بازگشت
              </button>
            </form>
          )}

          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5">شماره موبایل شما</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8">
                کد تأیید {toPersianDigits(OTP_LENGTH)} رقمی برای این شماره پیامک می‌شود.
              </div>
              <input
                type="tel"
                inputMode="numeric"
                dir="ltr"
                placeholder="09121234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full text-center tracking-widest px-4 py-4 rounded-2xl border-2 border-border focus:border-primary outline-none text-lg font-semibold mb-3"
              />
              {error && <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50"
              >
                {submitting ? "در حال ارسال..." : "دریافت کد تأیید"}
              </button>
              <button type="button" onClick={() => setStep("details")} className="w-full text-center mt-4 text-[12.5px] font-semibold text-muted">
                بازگشت
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleOtpSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5">کد تأیید را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-2">
                کد {toPersianDigits(OTP_LENGTH)} رقمی به شماره{" "}
                <span className="text-ink font-semibold" dir="ltr">
                  {phone}
                </span>{" "}
                پیامک شد.
              </div>
              {devCode ? (
                <div className="text-[12.5px] text-accent font-semibold mb-6">(محیط توسعه) کد ارسالی: {toPersianDigits(devCode)}</div>
              ) : (
                <div className="mb-8" />
              )}
              <div dir="ltr" className="flex gap-3 mb-3">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputsRef.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit ? toPersianDigits(digit) : ""}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className={clsx(
                      "w-14 h-16 rounded-2xl border-2 text-center text-2xl font-bold outline-none",
                      digit ? "border-primary bg-primary-soft text-primary" : "border-border",
                    )}
                  />
                ))}
              </div>
              {error && <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>}
              <div className="flex items-center justify-between mb-7">
                <span className="text-[13px] text-muted">
                  {secondsLeft > 0 ? `ارسال مجدد کد تا ${toPersianDigits(mm)}:${toPersianDigits(ss)}` : ""}
                </span>
                {secondsLeft <= 0 && (
                  <button type="button" onClick={sendOtp} className="text-[13px] font-bold text-primary">
                    ارسال مجدد کد
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={otp.some((d) => !d) || submitting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-40"
              >
                {submitting ? "در حال بررسی..." : "تأیید"}
              </button>
            </form>
          )}

          {step === "confirm" && selectedService && (
            <form onSubmit={handleConfirmSubmit} className="max-w-sm mx-auto w-full flex flex-col gap-4">
              <div className="text-xl font-extrabold mb-1">تکمیل رزرو</div>
              {payment ? (
                <div className="text-[13px] leading-7 bg-primary-soft text-ink rounded-xl p-3.5">
                  <div className="font-bold mb-1">{payment.isFull ? "پرداخت کامل مبلغ جلسه" : "پرداخت بیعانه‌ی رزرو"}</div>
                  {payment.isFull
                    ? `مبلغ ${formatToman(payment.amount)} کل هزینه‌ی جلسه است و برای ثبت نهایی رزرو همین حالا در درگاه پرداخت می‌شود.`
                    : `مبلغ ${formatToman(payment.amount)} فقط بیعانه‌ی رزرو است (کل هزینه‌ی جلسه ${formatToman(selectedService.price)})؛ برای ثبت نهایی جلسه پرداخت می‌شود و باقی‌مانده را در زمان جلسه تسویه می‌کنید.`}
                </div>
              ) : null}
              <div>
                <label className="block text-[13px] font-semibold mb-1.5">نام و نام خانوادگی</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full text-[13.5px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
                />
              </div>
              {error && <div className="text-[13px] text-danger font-semibold">{error}</div>}
              <button
                type="submit"
                disabled={submitting || !customerName.trim()}
                className="py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-40"
              >
                {submitting ? "در حال ثبت..." : payment ? "تأیید و رفتن به درگاه پرداخت" : "ثبت نهایی نوبت"}
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="max-w-sm mx-auto text-center py-10">
              <div className="w-16 h-16 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto mb-5">
                <CheckIcon className="w-7 h-7" />
              </div>
              <div className="text-xl font-extrabold mb-2">درخواست نوبت شما ثبت شد</div>
              <p className="text-[13.5px] text-ink-soft leading-relaxed">
                {selectedService?.requiresCoordination
                  ? "پس از هماهنگی با کارشناس، زمان نهایی نوبت شما از طریق پیامک اطلاع داده می‌شود."
                  : "نتیجه‌ی بررسی (تأیید یا لغو)، تاریخ، ساعت، آدرس و لینک جزئیات جلسه از طریق پیامک برای شما ارسال می‌شود."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
