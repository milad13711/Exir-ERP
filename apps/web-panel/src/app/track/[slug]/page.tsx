"use client";

import { use, useRef, useState } from "react";
import { LogoMark, CheckIcon, BuildingIcon } from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import {
  requestTrackingOtp,
  verifyTrackingOtp,
  fetchTrackedProjects,
  ApiError,
  type PublicTrackedProject,
  type ProjectStageStatus,
} from "@/lib/api";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

const STATUS_LABELS: Record<string, string> = {
  PLANNING: "برنامه‌ریزی",
  ACTIVE: "در حال اجرا",
  ON_HOLD: "متوقف‌شده",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

const STAGE_STATUS_LABELS: Record<ProjectStageStatus, string> = {
  PENDING: "شروع‌نشده",
  AWAITING_APPROVAL: "منتظر تأیید",
  IN_PROGRESS: "در حال اجرا",
  DONE: "انجام‌شده",
  REJECTED: "رد‌شده",
};

type Step = "phone" | "otp" | "results";

export default function PublicTrackingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [step, setStep] = useState<Step>("phone");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [projects, setProjects] = useState<PublicTrackedProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestTrackingOtp(slug, phone.trim());
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
      const res = await verifyTrackingOtp(slug, phone.trim(), otp.join(""));
      const list = await fetchTrackedProjects(slug, res.trackingToken);
      setProjects(list);
      setStep("results");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد با خطا مواجه شد");
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
          <span className="font-extrabold">پیگیری پروژه</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[520px]">
          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5 text-center">شماره موبایل خود را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">
                برای مشاهده‌ی وضعیت پروژه‌های خود، شماره‌ای که با آن ثبت‌نام شده‌اید را وارد کنید.
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
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50"
              >
                {submitting ? "در حال ارسال..." : "دریافت کد تأیید"}
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
                    className="w-14 h-16 rounded-2xl border-2 text-center text-2xl font-bold outline-none border-border focus:border-primary"
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
                {submitting ? "در حال بررسی..." : "تأیید و مشاهده"}
              </button>
            </form>
          )}

          {step === "results" && (
            <div>
              <div className="text-xl font-extrabold mb-6 text-center">پروژه‌های شما</div>
              {projects.length === 0 ? (
                <div className="text-center text-muted text-sm py-10">پروژه‌ای برای این شماره یافت نشد</div>
              ) : (
                <div className="flex flex-col gap-4">
                  {projects.map((p) => (
                    <div key={p.projectNo} className="bg-white border border-border rounded-2xl p-4">
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                          <BuildingIcon className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <div className="text-[14px] font-bold">{p.name}</div>
                          <div className="text-[11.5px] text-muted">
                            #{toPersianDigits(p.projectNo)} · {STATUS_LABELS[p.status] ?? p.status}
                            {p.endDate ? ` · تا ${formatJalaliDate(p.endDate)}` : ""}
                          </div>
                        </div>
                      </div>
                      {p.stages.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {p.stages.map((s, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                                  s.status === "DONE"
                                    ? "bg-success text-white"
                                    : s.status === "IN_PROGRESS"
                                      ? "bg-primary text-white"
                                      : s.status === "REJECTED"
                                        ? "bg-danger-soft text-danger"
                                        : "bg-slate-100 text-muted"
                                }`}
                              >
                                {s.status === "DONE" ? <CheckIcon className="w-3 h-3" /> : toPersianDigits(i + 1)}
                              </div>
                              <span className="text-[12.5px] flex-1">{s.title}</span>
                              <span className="text-[11px] text-muted">{STAGE_STATUS_LABELS[s.status]}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
