"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SmsPackagePicker } from "@/components/sms/SmsPackagePicker";
import { fetchSmsPanelStatus, setSmsPanelConnection, ApiError, type SmsPanelStatus } from "@/lib/api";
import { toPersianDigits } from "@/lib/persian";

const EXIRSMS_URL = "https://exirsms.ir";
const FIELD = "w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary";

/** اتصال پنل پیامکی: پنل اختصاصی خودِ تننت، یا پنل مشترک اکسیر با خرید بسته. OTP و فاکتورهای پلتفرم همیشه از پنل اصلی شرکت می‌روند. */
export default function SmsPanelSettingsPage() {
  const [status, setStatus] = useState<SmsPanelStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchSmsPanelStatus().then((s) => {
      setStatus(s);
      if (s.senderNumber) setSenderNumber(s.senderNumber);
    });
  }, []);

  async function connect(mode: "NONE" | "SYSTEM" | "OWN") {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await setSmsPanelConnection({ mode, apiKey: mode === "OWN" ? apiKey : undefined, senderNumber: mode === "OWN" ? senderNumber : undefined });
      setStatus(next);
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <div className="text-muted text-sm">در حال بارگذاری...</div>;

  return (
    <div className="max-w-[720px] flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold mb-1">پنل پیامکی</h1>
        <p className="text-[13px] text-muted leading-relaxed">
          پیامک‌های ماژول‌های شما (دعوت مصاحبه، نوبت، یادآور چک و فاکتور، کمپین و ...) از پنل پیامکی خودتان ارسال می‌شود. پیامک ورود (OTP) و فاکتور/تمدید ماژول‌ها همیشه از
          پنل اصلی اکسیر می‌رود و به اعتبار شما ربطی ندارد.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[13px] font-bold">
            وضعیت:{" "}
            {status.mode === "NONE"
              ? "متصل نشده"
              : status.mode === "OWN"
                ? `پنل اختصاصی (${status.senderNumber ?? ""})`
                : status.mode === "LEGACY"
                  ? "پنل اصلی اکسیر (رایگان، موقت)"
                  : "پنل سیستمی اکسیر"}
          </div>
          {status.mode !== "NONE" && status.mode !== "LEGACY" && (
            <div className="text-[13px] font-extrabold text-primary">
              {status.smsCount === null ? "—" : `${toPersianDigits(status.smsCount.toLocaleString("en-US"))} پیامک`}
            </div>
          )}
        </div>
        {status.error && <div className="text-[12px] text-danger mt-2">{status.error}</div>}
        {status.mode === "LEGACY" && (
          <div className="mt-3 bg-warning-soft rounded-xl p-3.5 text-[12.5px] leading-7">
            حساب شما هنوز از پنل اصلی اکسیر پیامک می‌فرستد. برای ادامه‌ی ارسال، پنل اختصاصی خودتان را وصل کنید یا بسته‌ی پیامکی بخرید.
          </div>
        )}
        {status.mode === "NONE" && (
          <div className="mt-3 bg-primary-soft rounded-xl p-3.5 text-[12.5px] leading-7">
            پنل پیامکی ندارید؟ می‌توانید همین حالا در{" "}
            <a href={EXIRSMS_URL} target="_blank" rel="noreferrer" className="font-bold text-primary underline">
              exirsms.ir
            </a>{" "}
            رایگان پنل بسازید و کلید API و شماره‌ی ارسالتان را پایین وارد کنید.
          </div>
        )}
        {saved && <div className="text-[12.5px] text-success font-semibold mt-2">ذخیره شد ✓</div>}
      </Card>

      <Card className="p-5">
        <div className="text-[14px] font-extrabold mb-1">۱) پنل پیامکی اختصاصی من</div>
        <p className="text-[12.5px] text-muted mb-3">پیامک‌ها با شماره‌ی اختصاصی خودتان و از اعتبار پنل خودتان ارسال می‌شود.</p>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">کلید API پنل</span>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} dir="ltr" placeholder={status.mode === "OWN" ? "•••• (برای تغییر، کلید جدید را وارد کنید)" : ""} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">شماره‌ی ارسال اختصاصی</span>
            <input value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} dir="ltr" className={FIELD} />
          </label>
        </div>
        {error && <div className="text-[12.5px] text-danger mb-2">{error}</div>}
        <button
          onClick={() => connect("OWN")}
          disabled={busy || !apiKey.trim() || !senderNumber.trim()}
          className="text-[13px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer"
        >
          اتصال و بررسی پنل
        </button>
      </Card>

      <Card className="p-5">
        <div className="text-[14px] font-extrabold mb-1">۲) استفاده از پنل سیستمی اکسیر</div>
        <p className="text-[12.5px] text-muted mb-3">پنل اختصاصی ندارید؟ بسته‌ی پیامکی بخرید؛ بعد از پرداخت در درگاه، اعتبار همان لحظه شارژ می‌شود.</p>
        {status.mode !== "SYSTEM" ? (
          <button
            onClick={() => connect("SYSTEM")}
            disabled={busy}
            className="text-[13px] font-bold px-5 py-2.5 rounded-xl bg-accent-soft text-accent disabled:opacity-50 cursor-pointer mb-3"
          >
            فعال‌سازی پنل سیستمی
          </button>
        ) : (
          <div className="mb-3 text-[12.5px] text-success font-semibold">پنل سیستمی فعال است</div>
        )}
        <SmsPackagePicker />
      </Card>

      {status.mode !== "NONE" && (
        <button onClick={() => connect("NONE")} disabled={busy} className="self-start text-[12px] font-bold text-danger cursor-pointer">
          قطع اتصال پنل پیامکی
        </button>
      )}
    </div>
  );
}
