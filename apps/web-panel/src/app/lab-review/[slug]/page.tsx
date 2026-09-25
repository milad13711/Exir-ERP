"use client";

import { use, useRef, useState } from "react";
import { LogoMark } from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import {
  requestLabReviewOtp,
  verifyLabReviewOtp,
  fetchPendingLabSamples,
  confirmLabReceipt,
  searchLabReviewSample,
  submitLabReviewReport,
  finalizeLabReport,
  ApiError,
  type PublicPendingLabSample,
  type PublicRationSample,
} from "@/lib/api";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

type Step = "phone" | "otp" | "pending" | "search" | "report" | "finalize" | "done";
type ProposedLine = { ingredientName: string; quantityPerAnimalKg: string; unitCostSnapshot: string };

export default function PublicLabReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [step, setStep] = useState<Step>("phone");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [labToken, setLabToken] = useState("");
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [pending, setPending] = useState<PublicPendingLabSample[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [sampleNo, setSampleNo] = useState("");
  const [sample, setSample] = useState<PublicRationSample | null>(null);

  const [reviewedByName, setReviewedByName] = useState("");
  const [currentRationIssues, setCurrentRationIssues] = useState("");
  const [riskIfUnchanged, setRiskIfUnchanged] = useState("");
  const [newRecommendations, setNewRecommendations] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [urgentWarningSigns, setUrgentWarningSigns] = useState("");
  const [proposedLines, setProposedLines] = useState<ProposedLine[]>([{ ingredientName: "", quantityPerAnimalKg: "", unitCostSnapshot: "" }]);
  const [addToKnowledge, setAddToKnowledge] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestLabReviewOtp(slug, phone.trim());
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

  async function loadPending(token: string) {
    const list = await fetchPendingLabSamples(slug, token);
    setPending(list);
    setSelectedIds(new Set());
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await verifyLabReviewOtp(slug, phone.trim(), otp.join(""));
      setLabToken(res.labToken);
      await loadPending(res.labToken);
      setStep("pending");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmReceipt() {
    setError(null);
    setSubmitting(true);
    try {
      const ids = [...selectedIds];
      await confirmLabReceipt(slug, labToken, ids);
      if (ids.length === 1) {
        const confirmedSample = pending.find((s) => s.id === ids[0]);
        if (confirmedSample) {
          await openReportForm(confirmedSample.id, confirmedSample.sampleNo);
          return;
        }
      }
      await loadPending(labToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید دریافت با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const found = await searchLabReviewSample(slug, labToken, Number(sampleNo.trim()));
      setSample(found);
      setStep("report");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "نمونه یافت نشد");
    } finally {
      setSubmitting(false);
    }
  }

  async function openReportForm(id: string, no: number) {
    setError(null);
    setSubmitting(true);
    try {
      const found = await searchLabReviewSample(slug, labToken, no);
      setSample(found);
      setStep("report");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "دریافت اطلاعات نمونه با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!sample) return;
    setError(null);
    setSubmitting(true);
    try {
      const validLines = proposedLines.filter((l) => l.ingredientName.trim() && l.quantityPerAnimalKg && l.unitCostSnapshot);
      await submitLabReviewReport(slug, sample.id, {
        labToken,
        reviewedByName: reviewedByName || undefined,
        currentRationIssues,
        riskIfUnchanged,
        newRecommendations,
        expectedResult,
        urgentWarningSigns,
        proposedLines: validLines.map((l) => ({
          ingredientName: l.ingredientName,
          quantityPerAnimalKg: Number(l.quantityPerAnimalKg),
          unitCostSnapshot: Number(l.unitCostSnapshot),
        })),
        addToKnowledge,
      });
      setStep("finalize");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت گزارش با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinalize() {
    if (!sample) return;
    setError(null);
    setSubmitting(true);
    try {
      await finalizeLabReport(slug, sample.id, labToken);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید نهایی با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[560px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">پورتال آزمایشگاه جیره</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[560px]">
          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5 text-center">شماره کارشناس آزمایشگاه</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">
                شماره‌ای که به‌عنوان کارشناس آزمایشگاه ثبت شده را وارد کنید.
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
              {error && <div className="text-[13px] text-danger font-semibold mb-3 text-center">{error}</div>}
              <button type="submit" disabled={submitting} className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50">
                {submitting ? "در حال ارسال..." : "دریافت کد تأیید"}
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleOtpSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5">کد تأیید را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-2">
                کد {toPersianDigits(OTP_LENGTH)} رقمی به شماره <span className="text-ink font-semibold" dir="ltr">{phone}</span> پیامک شد.
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
                    className="w-14 h-16 rounded-2xl border-2 text-center text-2xl font-bold outline-none border-border focus:border-primary"
                  />
                ))}
              </div>
              {error && <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>}
              <div className="flex items-center justify-between mb-7">
                <span className="text-[13px] text-muted">{secondsLeft > 0 ? `ارسال مجدد کد تا ${toPersianDigits(mm)}:${toPersianDigits(ss)}` : ""}</span>
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

          {step === "pending" && (
            <div>
              <div className="text-xl font-extrabold mb-1.5 text-center">نمونه‌های در انتظار</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-6 text-center">
                نمونه‌هایی که رسیده را تیک بزنید و «تأیید دریافت» کنید — یا مستقیم با شماره جست‌وجو کنید.
              </div>

              {error && <div className="text-[13px] text-danger font-semibold mb-3 text-center">{error}</div>}

              {pending.length === 0 ? (
                <div className="text-center text-muted text-sm py-6 mb-6">در حال حاضر نمونه‌ی در انتظاری نیست</div>
              ) : (
                <div className="flex flex-col gap-2 mb-4">
                  {pending.map((s) => (
                    <label key={s.id} className="flex items-center gap-3 bg-white border border-border rounded-2xl p-4 cursor-pointer">
                      <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelected(s.id)} className="w-4.5 h-4.5" />
                      <div className="flex-1">
                        <div className="text-[14px] font-bold" dir="ltr">
                          #{s.sampleNo}
                        </div>
                        <div className="text-[11.5px] text-muted mt-0.5">
                          {formatJalaliDate(s.collectedAt)}
                          {s.collectedByName ? ` · کارشناس ثبت‌کننده: ${s.collectedByName}` : ""}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {pending.length > 0 && (
                <button
                  onClick={handleConfirmReceipt}
                  disabled={selectedIds.size === 0 || submitting}
                  className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold disabled:opacity-50 mb-6"
                >
                  {submitting ? "در حال تأیید..." : `تأیید دریافت (${toPersianDigits(selectedIds.size)} نمونه)`}
                </button>
              )}

              <form onSubmit={handleSearch} className="max-w-sm mx-auto w-full">
                <div className="text-[13px] font-semibold mb-2 text-center">یا مستقیم با شماره‌ی نمونه‌ی تأییدشده وارد شوید</div>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="شماره نمونه"
                  value={sampleNo}
                  onChange={(e) => setSampleNo(e.target.value)}
                  className="w-full text-center tracking-widest px-4 py-3 rounded-2xl border-2 border-border focus:border-primary outline-none text-base font-semibold mb-3"
                />
                <button type="submit" disabled={submitting || !sampleNo.trim()} className="w-full py-3 rounded-2xl border-2 border-primary text-primary text-[14px] font-bold disabled:opacity-50">
                  جست‌وجو و ثبت گزارش
                </button>
              </form>
            </div>
          )}

          {step === "report" && sample && (
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="text-[15px] font-extrabold mb-1" dir="ltr">
                #{sample.sampleNo}
              </div>
              <div className="text-[12.5px] text-muted mb-4">
                {sample.contact ? sample.contact.name : "هویت دامدار محدود شده است"} · {formatJalaliDate(sample.collectedAt)}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[12px] mb-4">
                <SampleMetric label="تعداد دام" value={sample.herdSize} />
                <SampleMetric label="کل شیر گله" value={sample.totalHerdMilkYieldLiters} />
                <SampleMetric label="میانگین هر دام" value={sample.avgMilkYieldPerAnimalLiters} />
                <SampleMetric label="چربی/پروتئین" value={sample.milkFatPercent ? `${sample.milkFatPercent} / ${sample.milkProteinPercent ?? "—"}` : null} />
              </div>
              {sample.currentRationDescription ? (
                <div className="text-[12.5px] text-ink-soft bg-slate-50 border border-border rounded-xl p-3 mb-4">{sample.currentRationDescription}</div>
              ) : null}

              <form onSubmit={handleSubmitReport} className="flex flex-col gap-4">
                <TextField label="نام شما (اختیاری)" value={reviewedByName} onChange={setReviewedByName} />
                <TextArea label="ایرادات جیره‌ی فعلی" value={currentRationIssues} onChange={setCurrentRationIssues} required />
                <TextArea label="ریسک عدم تغییر" value={riskIfUnchanged} onChange={setRiskIfUnchanged} required />
                <TextArea label="توصیه‌های جدید" value={newRecommendations} onChange={setNewRecommendations} required />
                <TextArea label="نتیجه‌ی قابل انتظار" value={expectedResult} onChange={setExpectedResult} required />
                <TextArea label="در صورت مشاهده‌ی موارد زیر فوراً اطلاع دهید" value={urgentWarningSigns} onChange={setUrgentWarningSigns} required />

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-semibold">جیره‌ی پیشنهادی (به‌ازای هر دام)</label>
                    <button
                      type="button"
                      onClick={() => setProposedLines((prev) => [...prev, { ingredientName: "", quantityPerAnimalKg: "", unitCostSnapshot: "" }])}
                      className="text-[12px] font-bold text-primary"
                    >
                      + افزودن ماده
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {proposedLines.map((l, i) => (
                      <div key={i} className="grid grid-cols-[1fr_90px_100px] gap-2">
                        <input
                          placeholder="نام ماده"
                          value={l.ingredientName}
                          onChange={(e) =>
                            setProposedLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, ingredientName: e.target.value } : row)))
                          }
                          className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                        />
                        <input
                          placeholder="کیلو/دام"
                          dir="ltr"
                          value={l.quantityPerAnimalKg}
                          onChange={(e) =>
                            setProposedLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, quantityPerAnimalKg: e.target.value } : row)))
                          }
                          className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                        />
                        <input
                          placeholder="قیمت/کیلو"
                          dir="ltr"
                          value={l.unitCostSnapshot}
                          onChange={(e) =>
                            setProposedLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, unitCostSnapshot: e.target.value } : row)))
                          }
                          className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
                  <input type="checkbox" checked={addToKnowledge} onChange={(e) => setAddToKnowledge(e.target.checked)} />
                  این توصیه به دانش سازمانی اضافه شود
                </label>

                {error && <div className="text-[13px] text-danger font-semibold">{error}</div>}
                <button type="submit" disabled={submitting} className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold disabled:opacity-50">
                  {submitting ? "در حال ثبت..." : "ثبت گزارش"}
                </button>
              </form>
            </div>
          )}

          {step === "finalize" && sample && (
            <div className="bg-white border border-border rounded-2xl p-6 text-center">
              <div className="text-[16px] font-extrabold mb-2">گزارش ثبت شد</div>
              <p className="text-[13px] text-ink-soft leading-relaxed mb-6">
                برای ارسال نهایی نتیجه به دامدار (نمونه #{sample.sampleNo})، تأیید نهایی کنید — پیامک حاوی لینک نتیجه برای او ارسال می‌شود.
              </p>
              {error && <div className="text-[13px] text-danger font-semibold mb-3">{error}</div>}
              <button onClick={handleFinalize} disabled={submitting} className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold disabled:opacity-50">
                {submitting ? "در حال ارسال..." : "تأیید نهایی و ارسال برای دامدار"}
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="bg-white border border-border rounded-2xl p-8 text-center">
              <div className="text-[16px] font-extrabold mb-2">گزارش با موفقیت نهایی و ارسال شد</div>
              <p className="text-[13px] text-ink-soft leading-relaxed">از همکاری شما سپاسگزاریم.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SampleMetric({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="bg-slate-50 border border-border rounded-lg p-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="font-bold">{value ?? "—"}</div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-1.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]" />
    </div>
  );
}

function TextArea({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        rows={2}
        className="w-full px-3.5 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
      />
    </div>
  );
}
