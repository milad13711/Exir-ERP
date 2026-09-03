"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatToman } from "@/lib/persian";
import {
  fetchPublicPlans,
  fetchPublicModules,
  fetchPublicIndustryTemplates,
  fetchQuote,
  ApiError,
  type PublicPlan,
  type PublicModule,
  type PublicIndustryTemplate,
  type PlanQuote,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function ConfigureClient() {
  const searchParams = useSearchParams();
  const templateCode = searchParams.get("template");

  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [modules, setModules] = useState<PublicModule[] | null>(null);
  const [templates, setTemplates] = useState<PublicIndustryTemplate[] | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [quote, setQuote] = useState<PlanQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [leadOpen, setLeadOpen] = useState(false);
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
    if (!planCode) return;
    setQuoteError(null);
    fetchQuote({ planCode, billingCycle, moduleCodes: selectedModules })
      .then(setQuote)
      .catch((err) => {
        setQuote(null);
        setQuoteError(err instanceof ApiError ? err.message : "محاسبه‌ی قیمت با خطا مواجه شد");
      });
  }, [planCode, billingCycle, selectedModules]);

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

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api"}/public/catalog/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          company: company || undefined,
          phone,
          estimatedValue: quote.total,
          configurationSummary: `پلن: ${quote.plan.name} (${billingCycle === "yearly" ? "سالانه" : "ماهانه"})${
            activeTemplate ? ` — قالب صنف: ${activeTemplate.name}` : ""
          } — ماژول‌ها: ${quote.moduleLines.map((l) => l.name).join("، ") || "بدون ماژول اضافه"} — جمع: ${quote.total.toLocaleString("en-US")} تومان`,
          requestedPlanCode: quote.plan.code,
          requestedIndustryTemplateCode: activeTemplate?.code,
        }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      setSubmitError("ارسال درخواست با خطا مواجه شد، لطفاً دوباره تلاش کنید");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 max-w-[1000px] mx-auto px-6 py-12 w-full">
      <h1 className="text-[22px] font-extrabold text-center">پیکربندی پلن</h1>
      <p className="text-[13.5px] text-muted text-center mt-2">
        {activeTemplate ? `شروع با قالب «${activeTemplate.name}» — ` : ""}
        پلن، ماژول‌ها و دوره‌ی صورت‌حساب را انتخاب کنید تا قیمت لحظه‌ای محاسبه شود
      </p>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 mt-8">
        <div className="flex flex-col gap-5">
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
            </div>
          </div>

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
                            m.isCore || selectedModules.includes(m.code)
                              ? "border-primary bg-primary-soft"
                              : "border-border bg-slate-50"
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
                          <div className="text-[11.5px] font-bold text-muted">
                            {m.priceMonthly > 0 ? `${formatToman(m.priceMonthly)}/ماه` : "رایگان"}
                          </div>
                        </label>
                      ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-5 h-fit sticky top-6">
          <div className="text-[13.5px] font-bold mb-3">خلاصه‌ی فاکتور</div>
          {quoteError ? (
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

          {!leadOpen ? (
            <button
              onClick={() => setLeadOpen(true)}
              disabled={!quote}
              className="mt-5 w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              درخواست فعال‌سازی
            </button>
          ) : submitted ? (
            <div className="mt-5 text-center text-[12.5px] text-success font-semibold leading-relaxed">
              درخواست شما ثبت شد ✓
              <br />
              <span className="text-muted font-normal">کارشناسان ما به‌زودی برای فعال‌سازی و پرداخت با شما تماس می‌گیرند.</span>
            </div>
          ) : (
            <form onSubmit={handleLeadSubmit} className="mt-5 flex flex-col gap-2.5">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام و نام خانوادگی" className={inputClass} required />
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="نام کسب‌وکار (اختیاری)" className={inputClass} />
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
              <button
                type="submit"
                disabled={submitting}
                className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
              >
                {submitting ? "در حال ارسال..." : "ارسال درخواست"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
