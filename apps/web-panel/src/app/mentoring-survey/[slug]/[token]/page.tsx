"use client";

import { use, useEffect, useState } from "react";
import { LogoMark, CheckIcon } from "@/components/icons";
import { viewPublicMentoringSurvey, submitPublicMentoringSurvey, ApiError, type PublicMentoringSurveyView } from "@/lib/api";

const FACES = ["😞", "😕", "😐", "🙂", "😄"];

function RatingPicker({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div dir="ltr" className="flex items-center justify-between gap-2">
      {FACES.map((face, i) => {
        const score = i + 1;
        return (
          <button
            key={score}
            type="button"
            onClick={() => onChange(score)}
            className={`flex-1 aspect-square rounded-2xl text-2xl flex items-center justify-center border-2 cursor-pointer transition-colors ${
              value === score ? "border-primary bg-primary-soft" : "border-border bg-slate-50"
            }`}
          >
            {face}
          </button>
        );
      })}
    </div>
  );
}

export default function PublicMentoringSurveyPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [view, setView] = useState<PublicMentoringSurveyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    viewPublicMentoringSurvey(slug, token)
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : "این لینک معتبر نیست"));
  }, [slug, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await submitPublicMentoringSurvey(slug, token, { rating, note: note.trim() || undefined });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت نظر با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const alreadySubmitted = view?.submittedAt != null;

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <LogoMark className="w-5 h-5 text-primary" />
          </div>
          <span className="font-extrabold">نظرسنجی جلسه‌ی مشاوره</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[480px]">
          {error && <div className="text-[13px] text-danger font-semibold text-center bg-danger-soft rounded-2xl p-4">{error}</div>}

          {!error && !view && <div className="text-center text-muted text-sm py-10">در حال بارگذاری...</div>}

          {!error && view && (submitted || alreadySubmitted) && (
            <div className="bg-success-soft rounded-2xl p-6 text-center">
              <CheckIcon className="w-8 h-8 text-success mx-auto mb-2" />
              <div className="text-[15px] font-bold text-success">از نظر شما سپاسگزاریم</div>
            </div>
          )}

          {!error && view && !submitted && !alreadySubmitted && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="text-center">
                <div className="text-[14px] font-bold mb-1">جلسه‌ی «{view.session.engagement.title}» به پایان رسید</div>
                <div className="text-[12.5px] text-muted">نظر شما درباره‌ی جلسه با {view.session.engagement.advisor.name} به بهبود کیفیت کمک می‌کند</div>
              </div>

              <div className="bg-white border border-border rounded-2xl p-4">
                <div className="text-[13px] font-semibold mb-3 text-center">رضایت کلی از جلسه</div>
                <RatingPicker value={rating} onChange={setRating} />
              </div>

              <div className="bg-white border border-border rounded-2xl p-4">
                <div className="text-[13px] font-semibold mb-2">یادداشت (اختیاری)</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="اگر نکته‌ای هست، اینجا بنویسید..."
                  className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50"
              >
                {submitting ? "در حال ثبت..." : "ثبت نظر"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
