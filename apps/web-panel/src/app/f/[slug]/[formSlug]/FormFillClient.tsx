"use client";

import { useState } from "react";
import { DocsIcon, CheckIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { publicFormCoverImageUrl, submitPublicForm, ApiError, type PublicFormView } from "@/lib/api";

const inputClass =
  "w-full text-[13.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-4 py-3 focus:border-primary transition-colors";
const FACES = ["😞", "😕", "😐", "🙂", "😄"];

type AnswerValue = { valueText?: string; valueOptions?: string[] };

export function FormFillClient({ tenantSlug, formSlug, form }: { tenantSlug: string; formSlug: string; form: PublicFormView }) {
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
      setError("شماره موبایل الزامی است");
      return;
    }
    for (const field of form.fields) {
      if (!field.required) continue;
      const a = answers[field.id];
      const hasValue = a?.valueText?.trim() || (a?.valueOptions && a.valueOptions.length > 0);
      if (!hasValue) {
        setError(`پاسخ به «${field.label}» الزامی است`);
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
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت پاسخ ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div dir="rtl" className="min-h-dvh bg-slate-50 flex items-center justify-center p-5">
        <div className="max-w-[440px] w-full bg-white rounded-2xl border border-border p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto mb-4">
            <CheckIcon className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-extrabold mb-1">پاسخ شما ثبت شد</h1>
          {result.scorePercent != null && (
            <div className={`text-base font-extrabold mt-3 ${result.passed ? "text-success" : "text-danger"}`}>
              نمره‌ی شما: {toPersianDigits(result.scorePercent)}٪ — {result.passed ? "قبول" : "ناموفق"}
            </div>
          )}
          {result.thankYouMessage && <p className="text-[13px] text-ink-soft mt-3">{result.thankYouMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-white">
      {form.coverImage && (
        <div className="h-48 sm:h-60 bg-primary-soft overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicFormCoverImageUrl(tenantSlug, formSlug)} alt={form.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="max-w-[560px] mx-auto px-5 py-8">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <DocsIcon className="w-4 h-4" />
          </div>
          <h1 className="text-xl font-extrabold">{form.title}</h1>
        </div>
        {form.description && <p className="text-[13.5px] text-ink-soft leading-relaxed mt-2">{form.description}</p>}

        {form.isClosed ? (
          <div className="mt-6 text-center text-[13px] font-bold text-muted bg-slate-50 rounded-xl py-4">مهلت ثبت این فرم به پایان رسیده است</div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
            {form.collectPhone && (
              <>
                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نام شما (اختیاری)</label>
                  <input value={respondentName} onChange={(e) => setRespondentName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">
                    شماره موبایل {form.requirePhone ? "" : "(اختیاری)"}
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
              {submitting ? "در حال ثبت..." : "ثبت پاسخ"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
