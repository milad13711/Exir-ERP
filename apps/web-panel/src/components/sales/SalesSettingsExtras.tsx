"use client";

import { useEffect, useState } from "react";
import { formatJalaliDate, formatToman, toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  fetchAccountingBackfillPreview,
  fetchSignaturePolicy,
  runAccountingBackfill,
  setSignaturePolicy,
  type AccountingBackfillBatch,
  type AccountingBackfillPreview,
  type SignaturePolicy,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const POLICY_LABELS: Record<SignaturePolicy, string> = {
  off: "خاموش",
  optional: "اختیاری — دکمه‌ی «درخواست امضا» روی فاکتور",
  required: "الزامی — فاکتور بدون امضای مدیر صادر نمی‌شود",
};

/** «نیاز به امضای داخلی برای فاکتور» + (فقط با حسابداری نصب‌شده) «ثبت اسناد حسابداری فاکتورهای قبلی». */
export function SalesSettingsExtras() {
  const { installedModules } = useWorkspace();
  const [policy, setPolicy] = useState<SignaturePolicy>("off");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchSignaturePolicy().then((r) => setPolicy(r.policy)).catch(() => {});
  }, []);

  async function change(p: SignaturePolicy) {
    setMsg(null);
    try {
      setPolicy((await setSignaturePolicy(p)).policy);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "ذخیره ناموفق بود");
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div>
        <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نیاز به امضای داخلی برای فاکتور</label>
        <select value={policy} onChange={(e) => change(e.target.value as SignaturePolicy)} className="w-full text-[13px] bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
          {(Object.keys(POLICY_LABELS) as SignaturePolicy[]).map((k) => (
            <option key={k} value={k}>{POLICY_LABELS[k]}</option>
          ))}
        </select>
        <p className="text-[11.5px] text-muted leading-6 mt-1.5">امضاکننده فقط با «امضا» یا «مهر و امضای شرکت» (تصاویر ثبت‌شده در تنظیمات عمومی) تأیید می‌کند یا با دلیل رد می‌کند.</p>
        {msg ? <div className="text-[12px] text-danger mt-1">{msg}</div> : null}
      </div>
      {installedModules.has("accounting") ? <AccountingBackfill /> : null}
    </div>
  );
}

function AccountingBackfill() {
  const [preview, setPreview] = useState<AccountingBackfillPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AccountingBackfillBatch | null>(null);
  const [useToday, setUseToday] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchAccountingBackfillPreview().then(setPreview).catch((e) => setError(e instanceof ApiError ? e.message : "فقط مالک/مدیر"));
  useEffect(() => {
    load();
  }, []);

  async function run() {
    if (!window.confirm("اسناد حسابداری فاکتورها، پرداخت‌ها و مرجوعی‌های ثبت‌نشده صادر می‌شود. ادامه می‌دهید؟")) return;
    setRunning(true);
    setError(null);
    try {
      let res = await runAccountingBackfill({ confirm: true, limit: 100, dateMode: useToday ? "TODAY_IF_LOCKED" : "ORIGINAL" });
      setResult(res);
      while (!res.done) {
        res = await runAccountingBackfill({ confirm: true, limit: 100, stage: res.stage, cursor: res.cursor, runId: res.runId, dateMode: useToday ? "TODAY_IF_LOCKED" : "ORIGINAL" });
        setResult(res);
      }
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "اجرا ناموفق بود");
    } finally {
      setRunning(false);
    }
  }

  if (!preview) return error ? <div className="text-[12px] text-danger">{error}</div> : null;
  const pending = preview.invoices.count + preview.payments.count + preview.returns.count;
  return (
    <div className="border border-border rounded-xl p-3.5 bg-slate-50 flex flex-col gap-2">
      <div className="text-[12.5px] font-bold">ثبت اسناد حسابداری فاکتورهای قبلی</div>
      {pending === 0 ? (
        <div className="text-[12px] text-muted">فاکتور یا پرداختی بدون سند حسابداری وجود ندارد.</div>
      ) : (
        <>
          <div className="text-[12px] leading-6">
            {toPersianDigits(preview.invoices.count)} فاکتور ({formatToman(preview.invoices.total)})
            {preview.invoices.from && preview.invoices.to ? ` از ${formatJalaliDate(new Date(preview.invoices.from))} تا ${formatJalaliDate(new Date(preview.invoices.to))}` : ""}، {toPersianDigits(preview.payments.count)} پرداخت ({formatToman(preview.payments.total)})، {toPersianDigits(preview.returns.count)} مرجوعی
          </div>
          {preview.blockedCount > 0 ? (
            <div className="text-[11.5px] text-warning bg-warning-soft rounded-lg px-3 py-2 leading-6">
              {toPersianDigits(preview.blockedCount)} مورد قابل ثبت نیست:
              {preview.blocked.slice(0, 5).map((b) => (
                <div key={b.type + b.id}>• {b.type === "INVOICE" ? "فاکتور" : b.type === "PAYMENT" ? "پرداخت" : "مرجوعی"} {b.no ? toPersianDigits(b.no) : ""} — {b.reason}</div>
              ))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={useToday} onChange={(e) => setUseToday(e.target.checked)} />
            موارد دوره‌ی مالی بسته با تاریخ امروز ثبت شوند
          </label>
          <button type="button" onClick={run} disabled={running} className="py-2 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
            {running ? "در حال ثبت..." : "ثبت اسناد"}
          </button>
        </>
      )}
      {result ? (
        <div className="text-[12px] leading-6">
          ثبت‌شده: {toPersianDigits(result.report.posted.invoices)} فاکتور، {toPersianDigits(result.report.posted.payments)} پرداخت، {toPersianDigits(result.report.posted.returns)} مرجوعی — ردشده {toPersianDigits(result.report.skipped)}، ناموفق {toPersianDigits(result.report.failed)}
          {result.done ? " ✓ پایان" : ""}
          {result.report.issues.slice(0, 5).map((b) => (
            <div key={b.type + b.id} className="text-danger">• {b.no ? toPersianDigits(b.no) : ""} {b.reason}</div>
          ))}
        </div>
      ) : preview.lastReport ? (
        <div className="text-[11.5px] text-muted">آخرین اجرا: {formatJalaliDate(new Date(preview.lastReport.updatedAt))} — {toPersianDigits(preview.lastReport.posted.invoices)} فاکتور</div>
      ) : null}
      {error ? <div className="text-[12px] text-danger">{error}</div> : null}
    </div>
  );
}
