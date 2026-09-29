"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { requestArchiveOtp, verifyArchiveOtp, ApiError } from "@/lib/api";

/**
 * گام پله‌ای OTP برای ورود به آرشیو — کد پیامکی روی شماره‌ی خودِ کاربر
 * لاگین‌شده ارسال می‌شود (سمت سرور تعیین می‌شود، این کامپوننت هیچ شماره‌ای
 * نمی‌گیرد). موفقیت یعنی سرور هم OTP را تأیید کرده هم مجوز آرشیو کاربر را
 * چک کرده — نتیجه یک «بلیط طاق» کوتاه‌مدت است که فقط در حافظه نگه داشته
 * می‌شود (نه localStorage)، پس با رفرش صفحه از بین می‌رود و باید دوباره
 * تأیید شود.
 */
export function OtpStepUpModal({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: (vaultTicket: string, canEdit: boolean) => void;
}) {
  const [phase, setPhase] = useState<"sending" | "code" | "verifying">("sending");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    requestArchiveOtp()
      .then((res) => {
        setDevCode(res.devCode ?? null);
        setPhase("code");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "ارسال کد ناموفق بود");
        setPhase("code");
      });
  }, []);

  async function resend() {
    setPhase("sending");
    setError(null);
    try {
      const res = await requestArchiveOtp();
      setDevCode(res.devCode ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارسال کد ناموفق بود");
    } finally {
      setPhase("code");
    }
  }

  async function verify() {
    if (code.trim().length !== 4) {
      setError("کد ۴ رقمی را کامل وارد کنید");
      return;
    }
    setPhase("verifying");
    setError(null);
    try {
      const res = await verifyArchiveOtp(code.trim());
      onVerified(res.vaultTicket, res.canEdit);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تأیید کد ناموفق بود");
      setPhase("code");
    }
  }

  return (
    <Modal title="تأیید هویت برای ورود به آرشیو" onClose={onClose} width="max-w-[380px]">
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-muted leading-6">
          برای مشاهده‌ی اسناد محرمانه، کد تأیید پیامکی به شماره‌ی خودتان ارسال شد. این تأیید هر بار که وارد آرشیو می‌شوید دوباره لازم است.
        </p>
        {devCode ? (
          <div className="text-[12px] text-warning bg-warning-soft rounded-lg px-3 py-2">
            حالت توسعه — کد: <span className="font-mono font-bold">{devCode}</span>
          </div>
        ) : null}
        {error ? <div className="text-[12.5px] text-danger">{error}</div> : null}

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="کد ۴ رقمی"
          inputMode="numeric"
          disabled={phase === "sending"}
          className="text-center tracking-[6px] text-[18px] font-bold outline-none bg-surface border border-border rounded-lg px-3 py-2.5 focus:border-primary"
        />

        <button
          onClick={verify}
          disabled={phase !== "code" || code.length !== 4}
          className="text-[13px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-60"
        >
          {phase === "verifying" ? "در حال تأیید…" : "تأیید و ورود"}
        </button>

        <button
          onClick={resend}
          disabled={phase === "sending"}
          className="text-[12px] font-bold text-primary cursor-pointer disabled:opacity-60"
        >
          ارسال دوباره‌ی کد
        </button>
      </div>
    </Modal>
  );
}
