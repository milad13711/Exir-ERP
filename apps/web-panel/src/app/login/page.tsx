"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  LogoMark,
  BoltIcon,
  StoreIcon,
  FactoryIcon,
  ReceiptIcon,
  SettingsIcon,
  WarehouseIcon,
  BellIcon,
} from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import {
  requestOtp,
  verifyOtp,
  selectTenant,
  setToken,
  ApiError,
  fetchPublicIndustryTemplates,
  type PublicIndustryTemplate,
  type TenantCard,
} from "@/lib/api";

const TEMPLATE_ICONS: Record<string, typeof StoreIcon> = {
  "technical-services": BoltIcon,
  "retail-store": StoreIcon,
  "livestock-feed": FactoryIcon,
  "restaurant-cafe": ReceiptIcon,
  "auto-service": SettingsIcon,
  "wholesale-distribution": WarehouseIcon,
};

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp" | "tenant">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [templates, setTemplates] = useState<PublicIndustryTemplate[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantCard[]>([]);
  const [verificationToken, setVerificationToken] = useState("");

  useEffect(() => {
    fetchPublicIndustryTemplates().then((t) => setTemplates(t.slice(0, 6))).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (step !== "otp" || secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, secondsLeft]);

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestOtp(phone.trim());
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
    if (digit && index < OTP_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await verifyOtp(phone.trim(), otp.join(""));
      if ("requiresTenantSelection" in res) {
        setTenantOptions(res.tenants);
        setVerificationToken(res.verificationToken);
        setStep("tenant");
        return;
      }
      setToken(res.accessToken);
      router.push(res.billingLocked ? "/billing-locked" : "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ورود با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectTenant(slug: string) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await selectTenant(verificationToken, slug);
      setToken(res.accessToken);
      router.push(res.billingLocked ? "/billing-locked" : "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ورود با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div dir="rtl" className="min-h-dvh flex bg-white">
      <div className="hidden lg:flex flex-col justify-between flex-[0_0_46%] relative overflow-hidden p-14 bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600">
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/18 flex items-center justify-center">
            <LogoMark className="w-5.5 h-5.5 text-white" />
          </div>
          <span className="text-white text-xl font-extrabold">اکسیر ERP</span>
        </div>

        <div className="relative text-white max-w-md">
          <div className="text-[34px] font-extrabold leading-[1.55]">
            مدیریت یکپارچه‌ی کسب‌وکار،
            <br />
            ساده و سریع.
          </div>
          <div className="mt-4 text-[15px] leading-loose text-white/85">
            فروش، انبار، حسابداری و منابع انسانی در یک محیط فارسی، راست‌چین و کاملاً ماژولار.
          </div>

          <div className="mt-9">
            <a
              href="/signup"
              className="inline-flex items-center gap-1.5 text-[14px] font-extrabold text-primary bg-white hover:bg-white/90 transition-colors px-5 py-3 rounded-2xl shadow-lg"
            >
              کسب‌وکار جدید دارید؟ ثبت‌نام کنید ←
            </a>

            {templates.length > 0 && (
              <div className="mt-6">
                <div className="text-[12.5px] font-semibold text-white/70 mb-3">قالب آماده برای صنف شما:</div>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => {
                    const Icon = TEMPLATE_ICONS[t.code] ?? StoreIcon;
                    return (
                      <a
                        key={t.code}
                        href="/signup"
                        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/18 transition-colors rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-white"
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {t.name}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="relative flex gap-7 text-white/75 text-[13px]">
          <span>© اکسیر ۱۴۰۵</span>
          <span>حریم خصوصی</span>
          <span>پشتیبانی</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-sm">
          {step === "tenant" ? (
            <div>
              <div className="text-[13px] text-muted mb-2">ورود به حساب کاربری</div>
              <div className="text-2xl font-extrabold mb-1.5">محیط کاری را انتخاب کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8">
                این شماره در چند محیط کاری عضو است. یکی را برای ورود انتخاب کنید.
              </div>

              <div className="flex flex-col gap-3 mb-3">
                {tenantOptions.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleSelectTenant(t.slug)}
                    className="w-full text-right py-4 px-5 rounded-2xl border-2 border-border hover:border-primary hover:shadow-md transition-all disabled:opacity-50 relative overflow-hidden"
                  >
                    {t.pendingNotifications > 0 ? (
                      <span className="absolute top-3 left-3 flex items-center gap-1 bg-danger text-white text-[10.5px] font-bold px-2 py-1 rounded-full">
                        <BellIcon className="w-3 h-3" />
                        {toPersianDigits(t.pendingNotifications)}
                      </span>
                    ) : null}
                    <div className="flex items-center gap-3.5">
                      {t.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.logoUrl}
                          alt=""
                          className="w-11 h-11 rounded-xl object-cover border border-border shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 text-[15px] font-extrabold">
                          {t.name.trim().charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-[14.5px] truncate">{t.name}</div>
                        <div className="text-[10.5px] text-muted mt-1">
                          {formatJalaliDate(t.startDate)}
                          {t.expiresAt ? ` — ${formatJalaliDate(t.expiresAt)}` : ""}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {error ? (
                <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>
              ) : null}

              <button
                type="button"
                onClick={() => setStep("phone")}
                className="text-[13px] font-semibold text-primary"
              >
                ویرایش شماره
              </button>
            </div>
          ) : step === "phone" ? (
            <form onSubmit={handlePhoneSubmit}>
              <div className="text-[13px] text-muted mb-2">ورود به حساب کاربری</div>
              <div className="text-2xl font-extrabold mb-1.5">شماره موبایل خود را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8">
                کد تأیید ۴ رقمی برای این شماره پیامک می‌شود.
              </div>

              <label className="block text-[13px] font-semibold mb-2" htmlFor="phone">
                شماره موبایل
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                dir="ltr"
                placeholder="09121234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full text-center tracking-widest px-4 py-4 rounded-2xl border-2 border-border focus:border-primary outline-none text-lg font-semibold mb-3"
              />

              {error ? (
                <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold shadow-[0_8px_20px_-6px_rgba(67,56,202,0.5)] disabled:opacity-50"
              >
                {submitting ? "در حال ارسال..." : "دریافت کد تأیید"}
              </button>

              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[12px] text-muted font-semibold">یا</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <a
                href="/signup"
                className="w-full block text-center py-4 rounded-2xl border-2 border-primary text-primary text-base font-bold hover:bg-primary-soft transition-colors"
              >
                ثبت‌نام کسب‌وکار جدید
              </a>

              <div className="text-center mt-8 text-[12.5px] text-muted leading-relaxed">
                با ورود، <span className="text-primary font-semibold">قوانین و مقررات</span> اکسیر ERP را می‌پذیرید.
              </div>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <div className="text-[13px] text-muted mb-2">ورود به حساب کاربری</div>
              <div className="text-2xl font-extrabold mb-1.5">کد تأیید را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-2">
                کد {toPersianDigits(OTP_LENGTH)} رقمی به شماره{" "}
                <span className="text-ink font-semibold" dir="ltr">
                  {phone}
                </span>{" "}
                پیامک شد.{" "}
                <button
                  type="button"
                  onClick={() => setStep("phone")}
                  className="text-primary font-semibold"
                >
                  ویرایش شماره
                </button>
              </div>

              {devCode ? (
                <div className="text-[12.5px] text-accent font-semibold mb-6">
                  (محیط توسعه) کد ارسالی: {toPersianDigits(devCode)}
                </div>
              ) : (
                <div className="mb-8" />
              )}

              <div dir="ltr" className="flex flex-wrap gap-3 mb-3">
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

              {error ? (
                <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>
              ) : null}

              <div className="flex items-center justify-between mb-7">
                <span className="text-[13px] text-muted">
                  {secondsLeft > 0
                    ? `ارسال مجدد کد تا ${toPersianDigits(mm)}:${toPersianDigits(ss)}`
                    : ""}
                </span>
                {secondsLeft <= 0 ? (
                  <button type="button" onClick={sendOtp} className="text-[13px] font-bold text-primary">
                    ارسال مجدد کد
                  </button>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={otp.some((d) => !d) || submitting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold shadow-[0_8px_20px_-6px_rgba(67,56,202,0.5)] disabled:opacity-40"
              >
                {submitting ? "در حال بررسی..." : "تأیید و ورود"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
