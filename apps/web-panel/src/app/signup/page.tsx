"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  BuildingIcon,
  CheckIcon,
} from "@/components/icons";
import { toPersianDigits, formatToman } from "@/lib/persian";
import {
  fetchPublicIndustryTemplates,
  fetchPublicPlans,
  requestSignupOtp,
  verifySignupOtp,
  checkSlugAvailable,
  createPublicTenant,
  setToken,
  ApiError,
  type PublicIndustryTemplate,
  type PublicPlan,
} from "@/lib/api";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

const TEMPLATE_ICONS: Record<string, typeof StoreIcon> = {
  "technical-services": BoltIcon,
  "retail-store": StoreIcon,
  "livestock-feed": FactoryIcon,
  "restaurant-cafe": ReceiptIcon,
  "auto-service": SettingsIcon,
  "wholesale-distribution": WarehouseIcon,
};

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Step = "industry" | "phone" | "otp" | "details" | "done";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("industry");

  const [templates, setTemplates] = useState<PublicIndustryTemplate[] | null>(null);
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  useEffect(() => {
    fetchPublicIndustryTemplates().then(setTemplates).catch(() => setTemplates([]));
    fetchPublicPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const [selectedTemplate, setSelectedTemplate] = useState<PublicIndustryTemplate | "general" | null>(null);

  // phone / OTP
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [signupToken, setSignupToken] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // business details
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [planCode, setPlanCode] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ requiresPayment: boolean; tenantName: string } | null>(null);

  useEffect(() => {
    if (step !== "otp" || secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, secondsLeft]);

  useEffect(() => {
    if (!slugTouched && businessName.trim()) setSlug(slugify(businessName));
  }, [businessName, slugTouched]);

  useEffect(() => {
    if (!slug || !/^[a-z][a-z0-9-]{1,48}$/.test(slug)) {
      setSlugAvailable(null);
      return;
    }
    const t = setTimeout(() => {
      checkSlugAvailable(slug)
        .then((res) => setSlugAvailable(res.available))
        .catch(() => setSlugAvailable(null));
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  const publicPlans = useMemo(() => plans ?? [], [plans]);

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestSignupOtp(phone.trim());
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
      const res = await verifySignupOtp(phone.trim(), otp.join(""));
      setSignupToken(res.signupToken);
      setStep("details");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!signupToken || !planCode) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await createPublicTenant({
        signupToken,
        businessName: businessName.trim(),
        slug,
        ownerName: ownerName.trim(),
        planCode,
        industryTemplateCode:
          selectedTemplate && selectedTemplate !== "general" ? selectedTemplate.code : undefined,
      });
      if (res.accessToken) {
        setToken(res.accessToken);
        router.push("/dashboard");
        return;
      }
      setResult({ requiresPayment: res.requiresPayment, tenantName: res.tenant.name });
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت‌نام با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const accentColor =
    selectedTemplate && selectedTemplate !== "general" ? selectedTemplate.suggestedThemeColor ?? "#4338ca" : "#4338ca";

  const STEP_ORDER: Step[] = ["industry", "phone", "otp", "details", "done"];
  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[880px] mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
              <LogoMark className="w-5 h-5 text-primary" />
            </div>
            <span className="font-extrabold">اکسیر ERP</span>
          </div>
          <a href="/login" className="text-[12.5px] font-semibold text-primary">
            قبلاً حساب دارید؟ ورود
          </a>
        </div>
      </div>

      {step !== "done" && (
        <div className="max-w-[880px] w-full mx-auto px-6 pt-6">
          <div className="flex items-center gap-2">
            {["صنف شما", "شماره موبایل", "تأیید کد", "اطلاعات کسب‌وکار"].map((label, i) => (
              <div key={label} className="flex-1 flex items-center gap-2">
                <div
                  className={clsx(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                    i < stepIndex
                      ? "bg-success text-white"
                      : i === stepIndex
                        ? "bg-primary text-white"
                        : "bg-slate-200 text-muted",
                  )}
                >
                  {i < stepIndex ? <CheckIcon className="w-3 h-3" /> : toPersianDigits(i + 1)}
                </div>
                <span className={clsx("text-[11.5px] font-semibold hidden sm:inline", i <= stepIndex ? "text-ink" : "text-muted")}>
                  {label}
                </span>
                {i < 3 && <div className="flex-1 h-px bg-border" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[880px]">
          {step === "industry" && (
            <div>
              <div className="text-2xl font-extrabold mb-1.5 text-center">صنف کسب‌وکارتان را انتخاب کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">
                اکسیر برای هر صنف یک قالب آماده دارد — نقش‌ها، کدینگ حسابداری و دسته‌بندی کالا مخصوص همان صنف، از روز اول.
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {templates === null
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-[132px] rounded-2xl bg-white border border-border animate-pulse" />
                    ))
                  : templates.map((t) => {
                      const Icon = TEMPLATE_ICONS[t.code] ?? BuildingIcon;
                      const color = t.suggestedThemeColor ?? "#4338ca";
                      return (
                        <button
                          key={t.code}
                          onClick={() => {
                            setSelectedTemplate(t);
                            setStep("phone");
                          }}
                          className="text-right p-4.5 rounded-2xl bg-white border-2 border-border hover:border-primary transition-colors flex flex-col gap-2.5"
                        >
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center"
                            style={{ backgroundColor: `${color}1a`, color }}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="text-[14px] font-bold">{t.name}</div>
                          <div className="text-[11.5px] text-muted leading-relaxed">{t.description}</div>
                        </button>
                      );
                    })}
                <button
                  onClick={() => {
                    setSelectedTemplate("general");
                    setStep("phone");
                  }}
                  className="text-right p-4.5 rounded-2xl bg-white border-2 border-dashed border-border hover:border-primary transition-colors flex flex-col gap-2.5"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-ink-soft flex items-center justify-center">
                    <BuildingIcon className="w-5 h-5" />
                  </div>
                  <div className="text-[14px] font-bold">صنف من در لیست نیست</div>
                  <div className="text-[11.5px] text-muted leading-relaxed">
                    شروع با یک فضای کاری عمومی — بعداً هر ماژولی که خواستید نصب کنید.
                  </div>
                </button>
              </div>
            </div>
          )}

          {step === "phone" && (
            <div className="max-w-sm mx-auto">
              <form onSubmit={handlePhoneSubmit}>
                <div className="text-2xl font-extrabold mb-1.5">شماره موبایل مالک کسب‌وکار</div>
                <div className="text-sm text-ink-soft leading-relaxed mb-8">
                  کد تأیید {toPersianDigits(OTP_LENGTH)} رقمی برای این شماره پیامک می‌شود.
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
                {error && <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 rounded-2xl text-white text-base font-bold disabled:opacity-50"
                  style={{ backgroundColor: accentColor }}
                >
                  {submitting ? "در حال ارسال..." : "دریافت کد تأیید"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("industry")}
                  className="w-full text-center mt-4 text-[12.5px] font-semibold text-muted"
                >
                  بازگشت
                </button>
              </form>
            </div>
          )}

          {step === "otp" && (
            <div className="max-w-sm mx-auto">
              <form onSubmit={handleOtpSubmit}>
                <div className="text-2xl font-extrabold mb-1.5">کد تأیید را وارد کنید</div>
                <div className="text-sm text-ink-soft leading-relaxed mb-2">
                  کد {toPersianDigits(OTP_LENGTH)} رقمی به شماره{" "}
                  <span className="text-ink font-semibold" dir="ltr">
                    {phone}
                  </span>{" "}
                  پیامک شد.
                </div>
                {devCode ? (
                  <div className="text-[12.5px] text-accent font-semibold mb-6">
                    (محیط توسعه) کد ارسالی: {toPersianDigits(devCode)}
                  </div>
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
                  className="w-full py-4 rounded-2xl text-white text-base font-bold disabled:opacity-40"
                  style={{ backgroundColor: accentColor }}
                >
                  {submitting ? "در حال بررسی..." : "تأیید"}
                </button>
              </form>
            </div>
          )}

          {step === "details" && (
            <div className="max-w-lg mx-auto">
              <form onSubmit={handleCreateTenant} className="flex flex-col gap-5">
                <div>
                  <div className="text-2xl font-extrabold mb-1.5">اطلاعات کسب‌وکار</div>
                  <div className="text-sm text-ink-soft leading-relaxed">
                    این اطلاعات هر وقت خواستید از تنظیمات قابل ویرایش است.
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-semibold mb-1.5">نام کسب‌وکار</label>
                  <input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="مثلاً: بازرگانی سبزینه"
                    className="w-full text-[13.5px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold mb-1.5">آدرس محیط کاری شما</label>
                  <div className="flex items-center gap-2" dir="ltr">
                    <input
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(slugify(e.target.value));
                      }}
                      placeholder="my-business"
                      className="flex-1 text-[13.5px] text-left outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
                    />
                    <span className="text-[12.5px] text-muted">.exir-erp.ir</span>
                  </div>
                  {slug && slugAvailable === false && (
                    <div className="text-[12px] text-danger font-semibold mt-1.5">این آدرس قبلاً استفاده شده است</div>
                  )}
                  {slug && slugAvailable === true && (
                    <div className="text-[12px] text-success font-semibold mt-1.5">این آدرس آزاد است</div>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-semibold mb-1.5">نام و نام خانوادگی مالک</label>
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full text-[13.5px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold mb-2">پلن اشتراک</label>
                  <div className="flex flex-col gap-2">
                    {publicPlans.map((p) => (
                      <button
                        key={p.code}
                        type="button"
                        onClick={() => setPlanCode(p.code)}
                        className={clsx(
                          "flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border-2 text-right transition-colors",
                          planCode === p.code ? "border-primary bg-primary-soft" : "border-border bg-white",
                        )}
                      >
                        <div>
                          <div className="text-[13.5px] font-bold">{p.name}</div>
                          <div className="text-[11.5px] text-muted mt-0.5">تا {toPersianDigits(p.userLimit)} کاربر</div>
                        </div>
                        <div className="text-[13px] font-extrabold shrink-0">
                          {formatToman(p.priceMonthly)}
                          <span className="text-[11px] text-muted font-medium"> / ماه</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {error && <div className="text-[13px] text-danger font-semibold">{error}</div>}

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    !businessName.trim() ||
                    !ownerName.trim() ||
                    !planCode ||
                    slugAvailable !== true
                  }
                  className="w-full py-4 rounded-2xl text-white text-base font-bold disabled:opacity-40"
                  style={{ backgroundColor: accentColor }}
                >
                  {submitting ? "در حال ثبت..." : "ساخت محیط کاری"}
                </button>
              </form>
            </div>
          )}

          {step === "done" && result && (
            <div className="max-w-md mx-auto text-center py-10">
              <div className="w-16 h-16 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto mb-5">
                <CheckIcon className="w-7 h-7" />
              </div>
              <div className="text-xl font-extrabold mb-2">{result.tenantName} با موفقیت ساخته شد</div>
              {result.requiresPayment ? (
                <p className="text-[13.5px] text-ink-soft leading-relaxed">
                  فاکتور اشتراک شما صادر شد. همکاران ما در اسرع وقت با شما تماس می‌گیرند تا پرداخت را نهایی کنند —
                  بلافاصله بعد از تأیید، محیط کاری شما فعال و قابل ورود خواهد بود.
                </p>
              ) : (
                <p className="text-[13.5px] text-ink-soft leading-relaxed">محیط کاری شما فعال شد.</p>
              )}
              <a
                href="/login"
                className="inline-block mt-7 px-6 py-3 rounded-xl text-white text-[13.5px] font-bold"
                style={{ backgroundColor: accentColor }}
              >
                بازگشت به صفحه ورود
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
