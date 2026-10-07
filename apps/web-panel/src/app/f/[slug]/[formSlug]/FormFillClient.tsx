"use client";

import { useEffect, useRef, useState } from "react";
import { DocsIcon, CheckIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { publicFormCoverImageUrl, submitPublicForm, ApiError, type PublicFormView } from "@/lib/api";

const inputClass =
  "w-full text-[13.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-4 py-3 focus:border-primary transition-colors";
const FACES = ["😞", "😕", "😐", "🙂", "😄"];

type AnswerValue = { valueText?: string; valueOptions?: string[] };

/** تنظیمات حالت جاسازی (iframe) که اسکریپت /embed/exir-forms.js از طریق query می‌فرستد. */
export type EmbedOptions = {
  enabled: boolean;
  theme: "light" | "dark" | "auto";
  lang: "fa" | "en";
  primary: string | null;
  successMessage: string | null;
  hideTitle: boolean;
  sourceUrl: string | null;
  referrer: string | null;
  utm: Record<string, string>;
};

const TEXT = {
  fa: {
    name: "نام شما (اختیاری)",
    phone: "شماره موبایل",
    optional: "(اختیاری)",
    submit: "ثبت پاسخ",
    submitting: "در حال ثبت...",
    done: "پاسخ شما ثبت شد",
    closed: "مهلت ثبت این فرم به پایان رسیده است",
    phoneRequired: "شماره موبایل الزامی است",
    required: (l: string) => `پاسخ به «${l}» الزامی است`,
    score: "نمره‌ی شما",
    pass: "قبول",
    fail: "ناموفق",
    failed: "ثبت پاسخ ناموفق بود",
  },
  en: {
    name: "Your name (optional)",
    phone: "Mobile number",
    optional: "(optional)",
    submit: "Submit",
    submitting: "Submitting...",
    done: "Thank you — your response was received",
    closed: "This form is no longer accepting responses",
    phoneRequired: "Mobile number is required",
    required: (l: string) => `"${l}" is required`,
    score: "Your score",
    pass: "Passed",
    fail: "Failed",
    failed: "Submission failed",
  },
} as const;

const DARK_VARS: Record<string, string> = {
  "--color-white": "#0f172a",
  "--color-slate-50": "#1e293b",
  "--color-slate-100": "#273449",
  "--color-ink": "#e2e8f0",
  "--color-ink-soft": "#cbd5e1",
  "--color-muted": "#94a3b8",
  "--color-border": "#334155",
  "--color-primary-soft": "#1e2a52",
};

const DEFAULT_EMBED: EmbedOptions = { enabled: false, theme: "light", lang: "fa", primary: null, successMessage: null, hideTitle: false, sourceUrl: null, referrer: null, utm: {} };

export function FormFillClient({
  tenantSlug,
  formSlug,
  form,
  embed = DEFAULT_EMBED,
}: {
  tenantSlug: string;
  formSlug: string;
  form: PublicFormView;
  embed?: EmbedOptions;
}) {
  const t = TEXT[embed.lang];
  const rootRef = useRef<HTMLDivElement>(null);
  const [honeypot, setHoneypot] = useState("");
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    if (embed.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [embed.theme]);
  const embedBodyStyle = embed.enabled ? <style>{"html,body{background:transparent !important}"}</style> : null;
  const dark = embed.theme === "dark" || (embed.theme === "auto" && prefersDark);
  const themeStyle = {
    ...(dark ? DARK_VARS : {}),
    ...(embed.primary ? { "--color-primary": `#${embed.primary}`, "--color-primary-dark": `#${embed.primary}` } : {}),
  } as React.CSSProperties;

  // به صفحه‌ی میزبان (اسکریپت embed) ارتفاع و رویدادها را اطلاع می‌دهیم
  useEffect(() => {
    if (!embed.enabled || window.parent === window) return;
    const post = (msg: Record<string, unknown>) => window.parent.postMessage({ source: "exir-forms", ...msg }, "*");
    const send = () => post({ type: "resize", height: document.documentElement.scrollHeight });
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    post({ type: "ready" });
    return () => ro.disconnect();
  }, [embed.enabled]);

  const [respondentName, setRespondentName] = useState("");
  const [respondentPhone, setRespondentPhone] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scorePercent: number | null; passed: boolean | null; thankYouMessage: string | null } | null>(null);

  function setAnswer(fieldId: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.requirePhone && !respondentPhone.trim()) {
      setError(t.phoneRequired);
      return;
    }
    for (const field of form.fields) {
      if (!field.required) continue;
      const a = answers[field.id];
      const hasValue = a?.valueText?.trim() || (a?.valueOptions && a.valueOptions.length > 0);
      if (!hasValue) {
        setError(t.required(field.label));
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitPublicForm(tenantSlug, formSlug, {
        respondentName: respondentName.trim() || undefined,
        respondentPhone: respondentPhone.trim() || undefined,
        answers: Object.entries(answers).map(([fieldId, v]) => ({ fieldId, ...v })),
        _hp: honeypot || undefined,
        source: {
          url: embed.sourceUrl ?? window.location.href.split("#")[0],
          referrer: embed.referrer ?? (document.referrer || undefined),
          utm: Object.keys(embed.utm).length > 0 ? embed.utm : utmFromLocation(),
        },
      });
      setResult(res);
      if (embed.enabled && window.parent !== window) window.parent.postMessage({ source: "exir-forms", type: "submitted", submissionId: res.submissionId }, "*");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div dir={embed.lang === "en" ? "ltr" : "rtl"} ref={rootRef} style={themeStyle} className={embed.enabled ? "p-2" : "min-h-dvh bg-slate-50 flex items-center justify-center p-5"}>
        {embedBodyStyle}
        <div className="max-w-[440px] w-full mx-auto bg-white rounded-2xl border border-border p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto mb-4">
            <CheckIcon className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-extrabold mb-1">{t.done}</h1>
          {result.scorePercent != null && (
            <div className={`text-base font-extrabold mt-3 ${result.passed ? "text-success" : "text-danger"}`}>
              {t.score}: {toPersianDigits(result.scorePercent)}٪ — {result.passed ? t.pass : t.fail}
            </div>
          )}
          {(embed.successMessage || result.thankYouMessage) && <p className="text-[13px] text-ink-soft mt-3">{embed.successMessage || result.thankYouMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div dir={embed.lang === "en" ? "ltr" : "rtl"} ref={rootRef} style={themeStyle} className={embed.enabled ? "bg-transparent" : "min-h-dvh bg-white"}>
      {embedBodyStyle}
      {form.coverImage && !embed.enabled && (
        <div className="h-48 sm:h-60 bg-primary-soft overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicFormCoverImageUrl(tenantSlug, formSlug)} alt={form.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className={embed.enabled ? "max-w-[560px] mx-auto px-1 py-2" : "max-w-[560px] mx-auto px-5 py-8"}>
        {!embed.hideTitle && (<>
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <DocsIcon className="w-4 h-4" />
          </div>
          <h1 className="text-xl font-extrabold">{form.title}</h1>
        </div>
        {form.description && <p className="text-[13.5px] text-ink-soft leading-relaxed mt-2">{form.description}</p>}
        </>)}

        {form.isClosed ? (
          <div className="mt-6 text-center text-[13px] font-bold text-muted bg-slate-50 rounded-xl py-4">{t.closed}</div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
            {/* تله‌ی ربات: برای انسان نامرئی است؛ پر شدنش یعنی ربات */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" name="_hp" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </label>
            </div>
            {form.collectPhone && (
              <>
                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">{t.name}</label>
                  <input value={respondentName} onChange={(e) => setRespondentName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">
                    {t.phone} {form.requirePhone ? "" : t.optional}
                  </label>
                  <input
                    value={respondentPhone}
                    onChange={(e) => setRespondentPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    dir="ltr"
                    placeholder="09xxxxxxxxx"
                    className={inputClass}
                  />
                </div>
              </>
            )}

            {form.fields.map((field) => (
              <div key={field.id}>
                <label className="text-[12.5px] font-bold text-ink-soft mb-1.5 block">
                  {field.label}
                  {field.required && <span className="text-danger"> *</span>}
                </label>
                {field.helpText && <div className="text-[11.5px] text-muted mb-1.5">{field.helpText}</div>}

                {(field.type === "SHORT_TEXT" || field.type === "EMAIL") && (
                  <input
                    value={answers[field.id]?.valueText ?? ""}
                    onChange={(e) => setAnswer(field.id, { valueText: e.target.value })}
                    type={field.type === "EMAIL" ? "email" : "text"}
                    className={inputClass}
                  />
                )}
                {field.type === "LONG_TEXT" && (
                  <textarea value={answers[field.id]?.valueText ?? ""} onChange={(e) => setAnswer(field.id, { valueText: e.target.value })} rows={3} className={inputClass} />
                )}
                {field.type === "NUMBER" && (
                  <input
                    value={answers[field.id]?.valueText ?? ""}
                    onChange={(e) => setAnswer(field.id, { valueText: e.target.value.replace(/[^0-9.-]/g, "") })}
                    inputMode="decimal"
                    className={inputClass}
                  />
                )}
                {field.type === "PHONE" && (
                  <input
                    value={answers[field.id]?.valueText ?? ""}
                    onChange={(e) => setAnswer(field.id, { valueText: e.target.value.replace(/[^0-9]/g, "") })}
                    dir="ltr"
                    placeholder="09xxxxxxxxx"
                    className={inputClass}
                  />
                )}
                {field.type === "DATE" && (
                  <JalaliDateInput value={answers[field.id]?.valueText ?? ""} onChange={(v) => setAnswer(field.id, { valueText: v })} className={inputClass} />
                )}
                {field.type === "SINGLE_CHOICE" && (
                  <div className="flex flex-col gap-1.5">
                    {field.options.map((opt) => (
                      <label key={opt} className="flex items-center gap-2 text-[13px] bg-slate-50 border border-border rounded-lg px-3 py-2.5 cursor-pointer">
                        <input type="radio" name={field.id} checked={answers[field.id]?.valueText === opt} onChange={() => setAnswer(field.id, { valueText: opt })} />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
                {field.type === "MULTI_CHOICE" && (
                  <div className="flex flex-col gap-1.5">
                    {field.options.map((opt) => {
                      const selected = answers[field.id]?.valueOptions?.includes(opt) ?? false;
                      return (
                        <label key={opt} className="flex items-center gap-2 text-[13px] bg-slate-50 border border-border rounded-lg px-3 py-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              const cur = answers[field.id]?.valueOptions ?? [];
                              setAnswer(field.id, { valueOptions: selected ? cur.filter((o) => o !== opt) : [...cur, opt] });
                            }}
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                )}
                {field.type === "RATING" && (
                  <div dir="ltr" className="flex items-center gap-2">
                    {FACES.map((face, i) => {
                      const score = String(i + 1);
                      return (
                        <button
                          key={score}
                          type="button"
                          onClick={() => setAnswer(field.id, { valueText: score })}
                          className={`flex-1 aspect-square rounded-xl text-xl flex items-center justify-center border-2 cursor-pointer transition-colors ${
                            answers[field.id]?.valueText === score ? "border-primary bg-primary-soft" : "border-border bg-slate-50"
                          }`}
                        >
                          {face}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

            <button type="submit" disabled={submitting} className="py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer disabled:opacity-50">
              {submitting ? t.submitting : t.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function utmFromLocation(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = new URLSearchParams(window.location.search);
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]) {
    const v = p.get(k);
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}
