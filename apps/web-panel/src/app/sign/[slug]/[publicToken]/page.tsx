"use client";

import { use, useRef, useState } from "react";
import { LogoMark, DocsIcon, CheckIcon } from "@/components/icons";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { toPersianDigits, formatToman, formatJalaliDate, formatJalaliDateTime } from "@/lib/persian";
import {
  requestContractSignOtp,
  verifyContractSignOtp,
  viewPublicContract,
  submitPublicContractEditRequest,
  signPublicContract,
  ApiError,
  type Contract,
  type ContractPartySide,
} from "@/lib/api";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 48;

type Step = "phone" | "otp" | "view";

export default function PublicContractSignPage({ params }: { params: Promise<{ slug: string; publicToken: string }> }) {
  const { slug, publicToken } = use(params);
  const [step, setStep] = useState<Step>("phone");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [ticket, setTicket] = useState("");
  const [side, setSide] = useState<ContractPartySide>("PARTY_A");
  const [contract, setContract] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editText, setEditText] = useState("");
  const [editSubmitted, setEditSubmitted] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signed, setSigned] = useState(false);

  async function sendOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestContractSignOtp(slug, publicToken, phone.trim());
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
      const res = await verifyContractSignOtp(slug, publicToken, phone.trim(), otp.join(""));
      const c = await viewPublicContract(slug, publicToken, res.ticket);
      setTicket(res.ticket);
      setSide(res.side);
      setContract(c);
      setStep("view");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitEditRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!editText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPublicContractEditRequest(slug, publicToken, ticket, editText.trim());
      setEditText("");
      setEditSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت درخواست با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSign(signatureDataUrl: string) {
    if (!signerName.trim()) {
      setError("نام خود را وارد کنید");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signPublicContract(slug, publicToken, { ticket, signatureDataUrl, signerName: signerName.trim() });
      setSigned(true);
      setSigning(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "امضا با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  const mySigned = contract ? (side === "PARTY_A" ? contract.partyASignedAt : contract.partyBSignedAt) : null;
  const canSign = contract && !contract.isLocked && !mySigned && !signed;

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[560px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <LogoMark className="w-5 h-5 text-primary" />
          </div>
          <span className="font-extrabold">امضای دیجیتال قرارداد</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[520px]">
          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit} className="max-w-sm mx-auto w-full">
              <div className="text-xl font-extrabold mb-1.5 text-center">شماره موبایل خود را وارد کنید</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">
                برای مشاهده و امضای این قرارداد، شماره موبایل ثبت‌شده‌ی خود را در این قرارداد وارد کنید.
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

          {step === "view" && contract && (
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                    <DocsIcon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold">{contract.title}</div>
                    <div className="text-[11.5px] text-muted">قرارداد شماره {toPersianDigits(contract.contractNo)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 mb-3">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-[11px] text-muted mb-1">ارزش قرارداد</div>
                    <div className="text-[13px] font-extrabold">{formatToman(contract.value)}</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-[11px] text-muted mb-1">تاریخ پایان</div>
                    <div className="text-[13px] font-bold">{formatJalaliDate(contract.endDate)}</div>
                  </div>
                </div>
                {contract.terms && (
                  <div className="text-[12.5px] text-ink-soft leading-relaxed bg-slate-50 rounded-xl p-3 whitespace-pre-wrap mb-3">
                    {contract.terms}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className={`rounded-xl p-3 ${contract.partyASignedAt ? "bg-success-soft" : "bg-slate-50"}`}>
                    <div className="text-[11px] text-muted mb-1">طرف اول</div>
                    <div className="text-[12px] font-bold">
                      {contract.partyASignedAt ? `امضا شد — ${formatJalaliDateTime(contract.partyASignedAt)}` : "امضا نشده"}
                    </div>
                  </div>
                  <div className={`rounded-xl p-3 ${contract.partyBSignedAt ? "bg-success-soft" : "bg-slate-50"}`}>
                    <div className="text-[11px] text-muted mb-1">طرف دوم</div>
                    <div className="text-[12px] font-bold">
                      {contract.partyBSignedAt ? `امضا شد — ${formatJalaliDateTime(contract.partyBSignedAt)}` : "امضا نشده"}
                    </div>
                  </div>
                </div>
              </div>

              {error && <div className="text-[13px] text-danger font-semibold text-center">{error}</div>}

              {signed || mySigned ? (
                <div className="bg-success-soft text-success text-[13px] font-bold text-center rounded-2xl p-4 flex items-center justify-center gap-2">
                  <CheckIcon className="w-4 h-4" />
                  این قرارداد توسط شما امضا شد
                </div>
              ) : contract.isLocked ? (
                <div className="bg-slate-100 text-ink-soft text-[13px] font-bold text-center rounded-2xl p-4">
                  این قرارداد قبلاً توسط هر دو طرف امضا و قفل شده است
                </div>
              ) : signing ? (
                <div className="bg-white border border-border rounded-2xl p-4">
                  <div className="text-[12.5px] font-semibold mb-2">نام و نام‌خانوادگی</div>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5 mb-3"
                  />
                  <div className="text-[12.5px] font-semibold mb-2">امضای شما</div>
                  <SignaturePad onDone={handleSign} onCancel={() => setSigning(false)} />
                </div>
              ) : (
                canSign && (
                  <button
                    onClick={() => setSigning(true)}
                    className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold"
                  >
                    امضای دیجیتال قرارداد
                  </button>
                )
              )}

              {!contract.isLocked && !editSubmitted && (
                <form onSubmit={handleSubmitEditRequest} className="bg-white border border-border rounded-2xl p-4">
                  <div className="text-[12.5px] font-semibold mb-2">درخواست ویرایش (اختیاری)</div>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    placeholder="اگر تغییری در متن یا مبلغ قرارداد لازم است، اینجا بنویسید..."
                    className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5 mb-2.5"
                  />
                  <button
                    type="submit"
                    disabled={submitting || !editText.trim()}
                    className="w-full py-2.5 rounded-xl border border-border text-ink-soft text-[12.5px] font-bold disabled:opacity-50"
                  >
                    ارسال درخواست ویرایش
                  </button>
                </form>
              )}
              {editSubmitted && (
                <div className="text-[12.5px] text-primary font-semibold text-center">درخواست ویرایش شما ثبت شد</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
