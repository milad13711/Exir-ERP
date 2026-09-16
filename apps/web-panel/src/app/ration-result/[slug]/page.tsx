"use client";

import { use, useRef, useState } from "react";
import { LogoMark } from "@/components/icons";
import { toPersianDigits, formatJalaliDate, formatToman } from "@/lib/persian";
import {
  requestRationResultOtp,
  verifyRationResultOtp,
  fetchRationResultSamples,
  fetchRationResultSample,
  ApiError,
  type PublicRationResultSample,
  type PublicRationResultDetail,
} from "@/lib/api";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

type Step = "phone" | "otp" | "list" | "detail";

export default function PublicRationResultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [step, setStep] = useState<Step>("phone");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resultToken, setResultToken] = useState("");
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [samples, setSamples] = useState<PublicRationResultSample[]>([]);
  const [detail, setDetail] = useState<PublicRationResultDetail | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestRationResultOtp(slug, phone.trim());
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

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await verifyRationResultOtp(slug, phone.trim(), otp.join(""));
      setResultToken(res.resultToken);
      const list = await fetchRationResultSamples(slug, res.resultToken);
      setSamples(list);
      if (list.length === 1) {
        const d = await fetchRationResultSample(slug, list[0].id, res.resultToken);
        setDetail(d);
        setStep("detail");
      } else {
        setStep("list");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function openSample(id: string) {
    setSubmitting(true);
    try {
      const d = await fetchRationResultSample(slug, id, resultToken);
      setDetail(d);
      setStep("detail");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "دریافت نتیجه با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col print:bg-white">
      <div className="border-b border-border bg-white print:hidden">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <LogoMark className="w-5 h-5 text-primary" />
          </div>
          <span className="font-extrabold">نتیجه‌ی آزمایش جیره</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-[520px]">
          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5 text-center">شماره موبایل خود را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">همان شماره‌ای که هنگام نمونه‌برداری ثبت شده است.</div>
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
                {submitting ? "در حال بررسی..." : "تأیید و مشاهده"}
              </button>
            </form>
          )}

          {step === "list" && (
            <div>
              <div className="text-xl font-extrabold mb-6 text-center">نمونه‌های شما</div>
              {samples.length === 0 ? (
                <div className="text-center text-muted text-sm py-10">نتیجه‌ای برای این شماره یافت نشد</div>
              ) : (
                <>
                  {samples.some((s) => s.status === "SENT_TO_EXPERT") ? (
                    <div className="mb-6">
                      <div className="text-[12.5px] font-bold text-muted mb-2.5">نتایج جدید</div>
                      <div className="flex flex-col gap-3">
                        {samples
                          .filter((s) => s.status === "SENT_TO_EXPERT")
                          .map((s) => (
                            <SampleRow key={s.id} sample={s} onClick={() => openSample(s.id)} />
                          ))}
                      </div>
                    </div>
                  ) : null}
                  {samples.some((s) => s.status === "VIEWED_BY_FARMER") ? (
                    <div>
                      <div className="text-[12.5px] font-bold text-muted mb-2.5">بایگانی</div>
                      <div className="flex flex-col gap-3">
                        {samples
                          .filter((s) => s.status === "VIEWED_BY_FARMER")
                          .map((s) => (
                            <SampleRow key={s.id} sample={s} onClick={() => openSample(s.id)} />
                          ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {step === "detail" && detail && (
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-border rounded-2xl p-5 print:border-0">
                <div className="text-[13px] text-muted mb-1">نتیجه‌ی آزمایش جیره — نمونه</div>
                <div className="text-[16px] font-extrabold" dir="ltr">
                  {detail.sampleNo}
                </div>
                <div className="text-[11.5px] text-muted mt-1">تاریخ نمونه‌برداری: {formatJalaliDate(detail.collectedAt)}</div>
              </div>

              <ResultCard label="ایرادات جیره‌ی فعلی" text={detail.report.currentRationIssues} />
              <ResultCard label="ریسک عدم تغییر" text={detail.report.riskIfUnchanged} />
              <ResultCard label="توصیه‌های جدید" text={detail.report.newRecommendations} />
              <ResultCard label="نتیجه‌ی قابل انتظار" text={detail.report.expectedResult} />
              <ResultCard label="در صورت مشاهده‌ی موارد زیر فوراً به کارشناس اطلاع دهید" text={detail.report.urgentWarningSigns} warn />

              <div className="bg-white border border-border rounded-2xl p-5">
                <div className="text-[13px] font-extrabold mb-3">مقایسه‌ی هزینه‌ی جیره (به‌ازای هر دام)</div>
                <div className="flex items-center justify-between text-[13px] mb-1.5">
                  <span className="text-muted">هزینه‌ی جیره‌ی فعلی</span>
                  <span className="font-bold" dir="ltr">
                    {formatToman(detail.economics.currentTotalCost)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px] mb-1.5">
                  <span className="text-muted">هزینه‌ی جیره‌ی پیشنهادی</span>
                  <span className="font-bold" dir="ltr">
                    {formatToman(detail.economics.proposedTotalCost)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px] pt-2 border-t border-border mt-1">
                  <span className="font-bold">{detail.economics.delta <= 0 ? "صرفه‌جویی" : "افزایش هزینه"}</span>
                  <span className={`font-extrabold ${detail.economics.delta <= 0 ? "text-success" : "text-danger"}`} dir="ltr">
                    {formatToman(Math.abs(detail.economics.delta))}
                  </span>
                </div>
              </div>

              <button onClick={() => window.print()} className="w-full py-3.5 rounded-2xl border-2 border-primary text-primary text-[14px] font-bold print:hidden">
                چاپ این گزارش
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SampleRow({ sample, onClick }: { sample: PublicRationResultSample; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-right bg-white border border-border rounded-2xl p-4">
      <div className="text-[14px] font-bold" dir="ltr">
        {sample.sampleNo}
      </div>
      <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDate(sample.collectedAt)}</div>
    </button>
  );
}

function ResultCard({ label, text, warn }: { label: string; text: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 border ${warn ? "bg-danger-soft border-danger/20" : "bg-white border-border"}`}>
      <div className={`text-[12px] font-bold mb-1.5 ${warn ? "text-danger" : "text-muted"}`}>{label}</div>
      <div className={`text-[13.5px] leading-relaxed ${warn ? "text-danger font-semibold" : "text-ink-soft"}`}>{text}</div>
    </div>
  );
}
