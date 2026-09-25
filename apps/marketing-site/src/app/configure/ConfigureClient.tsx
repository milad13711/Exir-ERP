"use client";

import { HeroBand } from "@/components/Mandala";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { formatToman, formatUsd, toPersianDigits } from "@/lib/persian";
import {
  fetchPublicPlans,
  fetchPublicModules,
  fetchPublicIndustryTemplates,
  fetchQuote,
  fetchExchangeRate,
  submitLead,
  FALLBACK_USD_TOMAN_RATE,
  ApiError,
  type PublicPlan,
  type PublicModule,
  type PublicIndustryTemplate,
  type PlanQuote,
} from "@/lib/api";
import { licenseWeightOf, usdPricingFromLicense, sumUsdPricing, bundleUsdPricing, toToman, annualSupportPricing } from "@/lib/pricing";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

type Step = "plan" | "modules" | "summary";
const STEP_ORDER: Step[] = ["plan", "modules", "summary"];
const STEP_LABELS: Record<Step, string> = { plan: "پلن اشتراک", modules: "انتخاب ماژول", summary: "خلاصه و درخواست" };

function CheckIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DnaIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className}>
      <path
        d="M7 3c0 4 10 4 10 8s-10 4-10 8M17 3c0 4-10 4-10 8s10 4 10 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M8 6.5h8M8 17.5h8M7.3 12h9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function ConsultantIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className}>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 13.8v3.6l1.6-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ConfigureClient() {
  const searchParams = useSearchParams();
  const templateCode = searchParams.get("template");

  const [step, setStep] = useState<Step>("plan");

  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [modules, setModules] = useState<PublicModule[] | null>(null);
  const [templates, setTemplates] = useState<PublicIndustryTemplate[] | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly" | "license">("monthly");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [quote, setQuote] = useState<PlanQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [usdToToman, setUsdToToman] = useState<number | null>(null);

  useEffect(() => {
    fetchExchangeRate()
      .then((r) => setUsdToToman(r.usdToToman))
      .catch(() => setUsdToToman(FALLBACK_USD_TOMAN_RATE));
  }, []);

  const [consultingRequest, setConsultingRequest] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublicPlans().then((p) => {
      setPlans(p);
      if (p.length > 0) setPlanCode((prev) => prev || p[0].code);
    });
    fetchPublicModules().then(setModules);
    fetchPublicIndustryTemplates().then(setTemplates);
  }, []);

  // Preselect the chosen industry template's default modules once we know both.
  useEffect(() => {
    if (!templateCode || !templates) return;
    const t = templates.find((x) => x.code === templateCode);
    if (t) setSelectedModules(t.defaultModules);
  }, [templateCode, templates]);

  const activeTemplate = templates?.find((t) => t.code === templateCode) ?? null;

  useEffect(() => {
    if (!planCode || billingCycle === "license") return;
    setQuoteError(null);
    fetchQuote({ planCode, billingCycle, moduleCodes: selectedModules })
      .then(setQuote)
      .catch((err) => {
        setQuote(null);
        setQuoteError(err instanceof ApiError ? err.message : "محاسبه‌ی قیمت با خطا مواجه شد");
      });
  }, [planCode, billingCycle, selectedModules]);

  // حالت «خرید لایسنس» روی مدل قیمت‌گذاری دلاری/نرخ لحظه‌ای سایت حساب می‌شود
  // (همان چیزی که در /modules و /industries نمایش داده می‌شود) — نه روی
  // priceMonthly واقعی بک‌اند، چون آن قیمتِ اشتراک ماهانه/سالانه‌ی واقعی
  // است و لایسنس دائمی یک مدل قیمت‌گذاری کاملاً جدا دارد.
  const licenseQuote = useMemo(() => {
    if (billingCycle !== "license" || usdToToman == null) return null;
    const billable = (modules ?? []).filter((m) => selectedModules.includes(m.code) && !m.isCore);
    const moduleSum = sumUsdPricing(billable.map((m) => usdPricingFromLicense(licenseWeightOf(m.code))));
    const toman = toToman(bundleUsdPricing(moduleSum), usdToToman);
    return {
      lines: billable.map((m) => ({
        code: m.code,
        name: m.name,
        price: toToman(usdPricingFromLicense(licenseWeightOf(m.code)), usdToToman).license,
      })),
      license: toman.license,
      annualSupport: annualSupportPricing(usdToToman),
    };
  }, [billingCycle, usdToToman, modules, selectedModules]);

  function toggleModule(code: string, mod: PublicModule) {
    setSelectedModules((prev) => {
      const isSelected = prev.includes(code);
      if (isSelected) {
        // Also drop anything that depends on this module — keeps the
        // selection always self-consistent instead of erroring on quote.
        const stillNeeded = (modules ?? []).filter((m) => m.dependsOn.includes(code) && prev.includes(m.code));
        const toRemove = new Set([code, ...stillNeeded.map((m) => m.code)]);
        return prev.filter((c) => !toRemove.has(c));
      }
      return [...new Set([...prev, code, ...mod.dependsOn])];
    });
  }

  const categories = useMemo(() => {
    if (!modules) return [];
    return Array.from(new Set(modules.map((m) => m.category)));
  }, [modules]);

  function requestConsulting() {
    setConsultingRequest(true);
    setStep("summary");
  }

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (billingCycle === "license" ? !licenseQuote : !quote) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const estimatedValue = billingCycle === "license" ? licenseQuote!.license.toman : quote!.total;
      const configurationSummary =
        (consultingRequest ? "[درخواست مشاوره‌ی شخصی دکتر میلاد بهرامی] " : "") +
        (billingCycle === "license"
          ? `خرید لایسنس دائمی${activeTemplate ? ` — قالب صنف: ${activeTemplate.name}` : ""} — ماژول‌ها: ${
              licenseQuote!.lines.map((l) => l.name).join("، ") || "بدون ماژول اضافه"
            } — جمع لایسنس: ${licenseQuote!.license.toman.toLocaleString("en-US")} تومان (${formatUsd(licenseQuote!.license.usd)}) — پشتیبانی سالانه: ${licenseQuote!.annualSupport.toman.toLocaleString("en-US")} تومان (${formatUsd(licenseQuote!.annualSupport.usd)})`
          : `پلن: ${quote!.plan.name} (${billingCycle === "yearly" ? "سالانه" : "ماهانه"})${
              activeTemplate ? ` — قالب صنف: ${activeTemplate.name}` : ""
            } — ماژول‌ها: ${quote!.moduleLines.map((l) => l.name).join("، ") || "بدون ماژول اضافه"} — جمع: ${quote!.total.toLocaleString("en-US")} تومان`);
      await submitLead({
        name,
        company: company || undefined,
        phone,
        estimatedValue,
        configurationSummary,
        requestedPlanCode: billingCycle === "license" ? undefined : quote!.plan.code,
        requestedIndustryTemplateCode: activeTemplate?.code,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "ارسال درخواست با خطا مواجه شد، لطفاً دوباره تلاش کنید");
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const canProceedFromPlan = billingCycle === "license" ? true : Boolean(planCode);

  return (
    <main className="flex-1 w-full">
      <HeroBand>
        <div className="max-w-[1100px] mx-auto px-6 py-12 text-center">
          <h1 className="text-[24px] sm:text-[28px] font-extrabold leading-[1.5]">پیکربندی پلن و قیمت نرم‌افزار ERP فارسی اکسیر</h1>
          <p className="text-[13.5px] text-white/80 mt-3 leading-loose">
            {activeTemplate ? `شروع با قالب «${activeTemplate.name}» — ` : ""}
            پلن، ماژول‌ها و دوره‌ی صورت‌حساب را انتخاب کنید تا قیمت لحظه‌ای محاسبه شود
          </p>
        </div>
      </HeroBand>
      <div className="max-w-[1100px] mx-auto px-6 py-10 w-full">

      {/* نوار پیشرفت — همان ساختار ویزارد ثبت‌نام */}
      <div className="max-w-[560px] mx-auto mt-7">
        <div className="flex items-center gap-2">
          {STEP_ORDER.map((s, i) => (
            <div key={s} className="flex-1 flex items-center gap-2">
              <div
                className={clsx(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  i < stepIndex ? "bg-success text-white" : i === stepIndex ? "bg-primary text-white" : "bg-slate-200 text-muted",
                )}
              >
                {i < stepIndex ? <CheckIcon className="w-3 h-3" /> : toPersianDigits(i + 1)}
              </div>
              <span className={clsx("text-[11.5px] font-semibold hidden sm:inline", i <= stepIndex ? "text-ink" : "text-muted")}>
                {STEP_LABELS[s]}
              </span>
              {i < STEP_ORDER.length - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-8 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          {step === "plan" && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <label className={labelClass}>پلن اشتراک</label>
              {plans === null ? (
                <div className="text-muted text-sm py-3">در حال بارگذاری...</div>
              ) : (
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {plans.map((p) => (
                    <button
                      key={p.code}
                      onClick={() => setPlanCode(p.code)}
                      className={`text-right p-3.5 rounded-xl border-2 cursor-pointer transition-colors ${
                        planCode === p.code ? "border-primary bg-primary-soft" : "border-border bg-slate-50"
                      }`}
                    >
                      <div className="text-[13px] font-bold">{p.name}</div>
                      <div className="text-[11px] text-muted mt-1">تا {p.userLimit} کاربر</div>
                      <div className="text-[12px] font-extrabold mt-1.5">{formatToman(p.priceMonthly)}/ماه</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setBillingCycle("monthly")}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer ${
                    billingCycle === "monthly" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
                  }`}
                >
                  ماهانه
                </button>
                <button
                  onClick={() => setBillingCycle("yearly")}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer ${
                    billingCycle === "yearly" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
                  }`}
                >
                  سالانه
                </button>
                <button
                  onClick={() => setBillingCycle("license")}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer ${
                    billingCycle === "license" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
                  }`}
                >
                  خرید لایسنس
                </button>
              </div>
              {billingCycle === "license" ? (
                <p className="text-[11px] text-muted mt-2 leading-relaxed">
                  خرید لایسنس دائمی برای ماژول‌های انتخاب‌شده، به‌همراه پشتیبانی سالانه‌ی ثابت {formatUsd(199)} (مستقل از تعداد
                  ماژول). قیمت لنگر دلاری است و به نرخ لحظه‌ای تبدیل می‌شود.
                </p>
              ) : null}

              <div className="flex justify-end mt-5">
                <button
                  onClick={() => setStep("modules")}
                  disabled={!canProceedFromPlan}
                  className="px-6 py-3 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-40"
                >
                  بعدی: انتخاب ماژول‌ها ←
                </button>
              </div>
            </div>
          )}

          {step === "modules" && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <label className={labelClass}>ماژول‌ها</label>
              {modules === null ? (
                <div className="text-muted text-sm py-3">در حال بارگذاری...</div>
              ) : (
                categories.map((cat) => (
                  <div key={cat} className="mb-4 last:mb-0">
                    <div className="text-[11.5px] text-muted font-semibold mb-2">{cat}</div>
                    <div className="flex flex-col gap-1.5">
                      {modules
                        .filter((m) => m.category === cat)
                        .map((m) => (
                          <label
                            key={m.code}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer ${
                              m.isCore || selectedModules.includes(m.code) ? "border-primary bg-primary-soft" : "border-border bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={m.isCore || selectedModules.includes(m.code)}
                              disabled={m.isCore}
                              onChange={() => toggleModule(m.code, m)}
                              className="w-4 h-4 accent-[var(--color-primary)]"
                            />
                            <div className="flex-1">
                              <div className="text-[12.5px] font-bold">
                                {m.name}
                                {m.isCore ? <span className="text-[10.5px] text-muted font-normal"> (پایه)</span> : null}
                              </div>
                            </div>
                            <div className="text-[11.5px] font-bold text-muted text-left">
                              {billingCycle === "license" ? (
                                usdToToman != null && licenseWeightOf(m.code) > 0 ? (
                                  <>
                                    <div className="text-[10px] font-semibold" dir="ltr">
                                      {formatUsd(toToman(usdPricingFromLicense(licenseWeightOf(m.code)), usdToToman).license.usd)}
                                    </div>
                                    <div>{formatToman(toToman(usdPricingFromLicense(licenseWeightOf(m.code)), usdToToman).license.toman)} لایسنس</div>
                                  </>
                                ) : (
                                  "رایگان"
                                )
                              ) : m.priceMonthly > 0 ? (
                                `${formatToman(m.priceMonthly)}/ماه`
                              ) : (
                                "رایگان"
                              )}
                            </div>
                          </label>
                        ))}
                    </div>
                  </div>
                ))
              )}

              <div className="flex items-center gap-2 mt-5">
                <button onClick={() => setStep("plan")} className="text-[12.5px] font-semibold text-muted px-4 py-3 cursor-pointer">
                  بازگشت
                </button>
                <button
                  onClick={() => setStep("summary")}
                  className="flex-1 py-3 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer"
                >
                  بعدی: خلاصه و درخواست ←
                </button>
              </div>
            </div>
          )}

          {step === "summary" && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-[13.5px] font-bold mb-3">خلاصه‌ی فاکتور</div>
              {billingCycle === "license" ? (
                !licenseQuote ? (
                  <div className="text-muted text-sm py-3">در حال محاسبه...</div>
                ) : (
                  <>
                    {licenseQuote.lines.map((l) => (
                      <div key={l.code} className="flex items-center justify-between text-[12px] text-ink-soft py-2 border-b border-border">
                        <span>{l.name}</span>
                        <span className="text-left">
                          <div className="text-[10px] text-muted" dir="ltr">
                            {formatUsd(l.price.usd)}
                          </div>
                          <div>{formatToman(l.price.toman)}</div>
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[14px] font-extrabold">جمع لایسنس دائمی</span>
                      <span className="text-left">
                        <div className="text-[11px] text-muted font-bold" dir="ltr">
                          {formatUsd(licenseQuote.license.usd)}
                        </div>
                        <div className="text-[14px] font-extrabold">{formatToman(licenseQuote.license.toman)}</div>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[12px] text-muted mt-2">
                      <span>پشتیبانی سالانه (ثابت)</span>
                      <span className="text-left">
                        <span dir="ltr">{formatUsd(licenseQuote.annualSupport.usd)}</span> · {formatToman(licenseQuote.annualSupport.toman)}
                      </span>
                    </div>
                  </>
                )
              ) : quoteError ? (
                <div className="text-[12px] text-danger">{quoteError}</div>
              ) : !quote ? (
                <div className="text-muted text-sm py-3">در حال محاسبه...</div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[12.5px] py-2 border-b border-border">
                    <span>{quote.plan.name}</span>
                    <span className="font-bold">{formatToman(quote.plan.price)}</span>
                  </div>
                  {quote.moduleLines.map((l) => (
                    <div key={l.code} className="flex items-center justify-between text-[12px] text-ink-soft py-2 border-b border-border">
                      <span>{l.name}</span>
                      <span>{formatToman(l.price)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-[14px] font-extrabold mt-3">
                    <span>جمع کل ({billingCycle === "yearly" ? "سالانه" : "ماهانه"})</span>
                    <span>{formatToman(quote.total)}</span>
                  </div>
                </>
              )}

              {consultingRequest ? (
                <div className="mt-5 bg-accent-soft text-accent text-[12px] font-semibold rounded-xl p-3">
                  این درخواست به‌عنوان درخواست مشاوره‌ی شخصی دکتر میلاد بهرامی ثبت می‌شود — همکاران ما هماهنگی جلسه‌ی اولیه را انجام می‌دهند.
                </div>
              ) : null}

              {submitted ? (
                <div className="mt-5 text-center text-[12.5px] text-success font-semibold leading-relaxed">
                  درخواست شما ثبت شد ✓
                  <br />
                  <span className="text-muted font-normal">کارشناسان ما به‌زودی برای فعال‌سازی و پرداخت با شما تماس می‌گیرند.</span>
                </div>
              ) : (
                <form onSubmit={handleLeadSubmit} className="mt-5 flex flex-col gap-2.5">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام و نام خانوادگی" className={inputClass} required />
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="نام کسب‌وکار (اختیاری)"
                    className={inputClass}
                  />
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="شماره موبایل"
                    dir="ltr"
                    inputMode="numeric"
                    className={inputClass}
                    required
                  />
                  {submitError ? <div className="text-[11.5px] text-danger">{submitError}</div> : null}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStep("modules")}
                      className="text-[12.5px] font-semibold text-muted px-4 py-2.5 cursor-pointer"
                    >
                      بازگشت
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || (billingCycle === "license" ? !licenseQuote : !quote)}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      {submitting ? "در حال ارسال..." : consultingRequest ? "درخواست مشاوره" : "ارسال درخواست"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* نوار کناری ثابت — همیشه روی همه‌ی قدم‌ها دیده می‌شود */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="bg-surface border border-border rounded-2xl p-4.5">
            <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-3">
              <DnaIcon className="w-5 h-5" />
            </div>
            <div className="text-[13px] font-bold mb-1">طراحی متناسب با DNA سازمان شما</div>
            <div className="text-[11.5px] text-ink-soft leading-relaxed">
              اکسیر یک قالب یکسان برای همه نیست — ماژول‌ها، فرآیندها و کدینگ‌ها دقیقاً بر اساس ساختار واقعی کسب‌وکار شما پیکربندی می‌شوند.
            </div>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-4.5">
            <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-3">
              <ConsultantIcon className="w-5 h-5" />
            </div>
            <div className="text-[13px] font-bold mb-1">مشاوره‌ی شخصی دکتر میلاد بهرامی</div>
            <div className="text-[11.5px] text-ink-soft leading-relaxed mb-3">
              برای شرکت‌ها و کارخانه‌های بزرگ، معماری فرآیندها و استقرار سیستم شخصاً توسط دکتر میلاد بهرامی، مشاور تخصصی کسب‌وکار، انجام می‌شود.
            </div>
            {!consultingRequest ? (
              <button
                type="button"
                onClick={requestConsulting}
                className="text-[11.5px] font-bold text-accent cursor-pointer"
              >
                درخواست مشاوره‌ی تخصصی ←
              </button>
            ) : (
              <span className="text-[11.5px] font-bold text-success flex items-center gap-1">
                <CheckIcon className="w-3.5 h-3.5" /> ثبت خواهد شد
              </span>
            )}
          </div>
        </aside>
      </div>
      </div>
    </main>
  );
}
