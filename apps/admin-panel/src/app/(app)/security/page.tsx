"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  ApiError,
  beginTwoFaSetup,
  disableTwoFa,
  enableTwoFa,
  fetchSecurityEvents,
  fetchTwoFaStatus,
  invalidateAllSessions,
  type SecurityEventRow,
} from "@/lib/api";
import { useAdmin } from "@/lib/admin-context";

const TONES: Record<SecurityEventRow["level"], "neutral" | "warning" | "danger"> = { INFO: "neutral", WARNING: "warning", ERROR: "danger", FATAL: "danger" };
const inputCls = "w-full text-[14px] outline-none bg-slate-50 border border-border rounded-xl px-4 py-3 focus:border-primary focus:bg-white";
const btnCls = "text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer";

export default function SecurityPage() {
  const { admin } = useAdmin();
  const [status, setStatus] = useState<{ enabled: boolean; recoveryCodesLeft: number; required: boolean } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<SecurityEventRow[] | null>(null);
  const isSuper = admin?.team === "SUPER_ADMIN";

  function reload() {
    fetchTwoFaStatus().then(setStatus).catch(() => setStatus(null));
    if (isSuper) fetchSecurityEvents(100).then(setEvents).catch(() => setEvents([]));
  }
  useEffect(reload, [isSuper]);

  async function run(fn: () => Promise<void>) {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "خطایی رخ داد");
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader title="امنیت حساب" subtitle="تأیید دومرحله‌ای (TOTP) و ابزار پاسخ به حادثه" />

      <Card className="mt-6 p-5">
        <div className="text-[15px] font-extrabold mb-1">تأیید دومرحله‌ای</div>
        <p className="text-[12.5px] text-muted mb-4">
          با Google Authenticator، Authy یا 1Password. {status?.required ? "برای این پلتفرم اجباری است." : "توصیه‌ی جدی برای همه‌ی اعضای تیم."}
        </p>
        {status?.enabled ? (
          <div className="flex flex-col gap-3 max-w-[380px]">
            <Badge tone="neutral">فعال — {status.recoveryCodesLeft} کد بازیابی باقی مانده</Badge>
            <input className={inputCls} dir="ltr" type="password" placeholder="رمز عبور" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className={inputCls} dir="ltr" placeholder="کد ۶ رقمی یا کد بازیابی" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className={btnCls} disabled={!password || code.length < 6} onClick={() => run(async () => { await disableTwoFa(password, code); setPassword(""); setCode(""); reload(); })}>
              غیرفعال‌سازی
            </button>
          </div>
        ) : setup ? (
          <div className="flex flex-col gap-3 max-w-[480px]">
            <p className="text-[12.5px]">این کلید را در برنامه‌ی احراز هویت وارد کنید (نوع: مبتنی بر زمان) و سپس کد ۶ رقمی را بزنید:</p>
            <code dir="ltr" className="select-all break-all bg-slate-100 rounded-xl p-3 text-[13px]">{setup.secret}</code>
            <a dir="ltr" className="text-[12px] text-primary break-all" href={setup.otpauthUrl}>{setup.otpauthUrl}</a>
            <input className={inputCls} dir="ltr" inputMode="numeric" placeholder="کد ۶ رقمی" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className={btnCls} disabled={code.length !== 6} onClick={() => run(async () => { const r = await enableTwoFa(code); setRecovery(r.recoveryCodes); setSetup(null); setCode(""); reload(); })}>
              تأیید و فعال‌سازی
            </button>
          </div>
        ) : (
          <button className={btnCls} onClick={() => run(async () => setSetup(await beginTwoFaSetup()))}>شروع راه‌اندازی</button>
        )}
        {recovery ? (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="text-[13px] font-bold mb-2">کدهای بازیابی را همین حالا در جای امن ذخیره کنید (فقط یک‌بار نمایش داده می‌شود):</div>
            <pre dir="ltr" className="select-all text-[13px] leading-6">{recovery.join("\n")}</pre>
          </div>
        ) : null}
        {msg ? <div className="mt-3 text-[12.5px] text-danger">{msg}</div> : null}
      </Card>

      {isSuper ? (
        <>
          <Card className="mt-5 p-5">
            <div className="text-[15px] font-extrabold mb-1">پاسخ به حادثه</div>
            <p className="text-[12.5px] text-muted mb-4">خروج اجباری همه‌ی کاربران و کارشناسان (همه باید دوباره وارد شوند). برای یک تننت یا ابطال کلیدهای API از صفحه‌ی همان تننت یا runbook استفاده کنید.</p>
            <button
              className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-danger text-white cursor-pointer"
              onClick={() => {
                if (window.confirm("همه‌ی نشست‌ها (از جمله نشست خودتان) باطل می‌شود. ادامه می‌دهید؟")) run(async () => { await invalidateAllSessions(); setMsg("انجام شد؛ دوباره وارد شوید."); });
              }}
            >
              خروج اجباری همه
            </button>
          </Card>

          <Card className="mt-5 p-5">
            <div className="text-[15px] font-extrabold mb-3">رویدادهای امنیتی اخیر</div>
            {events === null ? <div className="text-[13px] text-muted">در حال بارگذاری...</div> : events.length === 0 ? <div className="text-[13px] text-muted">رویدادی ثبت نشده.</div> : (
              <div className="flex flex-col divide-y divide-border">
                {events.map((e) => (
                  <div key={e.id} className="py-2.5 flex items-start gap-3">
                    <Badge tone={TONES[e.level]}>{e.level}</Badge>
                    <div className="min-w-0 flex-1 text-[12.5px] break-words" dir="ltr">{e.message}</div>
                    <div className="text-[11.5px] text-muted shrink-0">{formatJalaliDateTime(e.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
