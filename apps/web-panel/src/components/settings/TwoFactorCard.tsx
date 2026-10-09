"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ApiError, beginTwoFaSetup, disableTwoFa, enableTwoFa, fetchTwoFaStatus, setToken, type TwoFactorPolicyState } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

/**
 * 2FA (TOTP) مالک/مدیر: QR + کلید + کد، نمایش یک‌باره‌ی کدهای بازیابی. هم در تنظیمات پروفایل و هم در صفحه‌ی
 * ثبت اجباری (/two-factor-setup) استفاده می‌شود. در حالت mandatory غیرفعال‌سازی نمایش داده نمی‌شود و بعد از
 * ثبت، توکن عادیِ برگشتی جایگزین توکن نشست محدود می‌شود.
 */
export function TwoFactorCard({
  id,
  mandatory = false,
  onEnabled,
}: {
  id?: string;
  mandatory?: boolean;
  /** بعد از ثبت موفق (کدهای بازیابی هنوز نمایش داده می‌شوند). */
  onEnabled?: (policy?: TwoFactorPolicyState) => void;
}) {
  const [status, setStatus] = useState<{ enabled: boolean; recoveryCodesLeft: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl?: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetchTwoFaStatus().then(setStatus).catch(() => setStatus(null));
  }
  useEffect(reload, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 p-6 max-w-[480px]" >
      <div id={id} className="text-[13px] font-bold mb-1">{mandatory ? "تأیید دومرحله‌ای (الزامی)" : "تأیید دومرحله‌ای"}</div>
      <p className="text-[12px] text-muted leading-relaxed mb-4">
        با فعال‌سازی، علاوه بر کد پیامکی، هنگام ورود یک کد ۶ رقمی از برنامه‌ی Google Authenticator / Authy هم لازم است. برای حساب مالک و مدیر این قابلیت اجباری است.
      </p>
      {status?.enabled ? (
        <div className="flex flex-col gap-3">
          <div className="text-[12.5px] text-success font-semibold">فعال است — {status.recoveryCodesLeft} کد بازیابی باقی مانده</div>
          {mandatory ? null : (
            <>
              <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" placeholder="کد ۶ رقمی یا کد بازیابی" className={inputClass} />
              <button
                type="button"
                disabled={busy || code.trim().length < 6}
                onClick={() => run(async () => { await disableTwoFa(code.trim()); setCode(""); reload(); })}
                className="px-5 py-2.5 rounded-xl bg-danger-soft text-danger text-[13px] font-bold cursor-pointer disabled:opacity-50"
              >
                غیرفعال‌سازی
              </button>
            </>
          )}
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-3">
          <div className="text-[12.5px]">کد QR را با برنامه‌ی احراز هویت اسکن کنید (یا کلید را دستی وارد کنید) و کد ۶ رقمی را وارد کنید:</div>
          {setup.qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={setup.qrDataUrl} alt="QR" width={220} height={220} className="self-center rounded-xl border border-border bg-white" />
          ) : null}
          <code dir="ltr" className="select-all break-all bg-slate-100 rounded-xl p-3 text-[13px]">{setup.secret}</code>
          <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" inputMode="numeric" placeholder="کد ۶ رقمی" className={inputClass} />
          <button
            type="button"
            disabled={busy || code.trim().length !== 6}
            onClick={() =>
              run(async () => {
                const r = await enableTwoFa(code.trim());
                if (r.accessToken) setToken(r.accessToken);
                setRecovery(r.recoveryCodes);
                setSetup(null);
                setCode("");
                reload();
                onEnabled?.(r.twoFactor);
              })
            }
            className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            تأیید و فعال‌سازی
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(async () => setSetup(await beginTwoFaSetup()))}
          className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          شروع راه‌اندازی
        </button>
      )}
      {recovery ? (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-[12.5px] font-bold mb-2">کدهای بازیابی را همین حالا در جای امن نگه دارید (فقط یک‌بار نمایش داده می‌شود):</div>
          <pre dir="ltr" className="select-all text-[13px] leading-6">{recovery.join("\n")}</pre>
        </div>
      ) : null}
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
    </Card>
  );
}
