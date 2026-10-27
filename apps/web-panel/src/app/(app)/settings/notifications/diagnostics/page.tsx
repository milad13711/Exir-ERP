"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { fetchPushAttempts, fetchPushStatus, fetchPushVapidKey, type PushAttemptRow, type PushStatus } from "@/lib/api";
import { autoRepairPush, collectLocalDiagnostics, deniedRecoverySteps, type LocalPushDiagnostics } from "@/lib/push-client";
import { describeTest, usePushTest } from "@/hooks/usePushTest";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";

type Check = { label: string; ok: boolean | null; detail?: string };

const PERMISSION_FA: Record<string, string> = { granted: "داده شده", denied: "مسدود", default: "هنوز پرسیده نشده", unsupported: "پشتیبانی نمی‌شود" };

function buildChecks(l: LocalPushDiagnostics, s: PushStatus | null): Check[] {
  const checks: Check[] = [
    { label: "اتصال امن (HTTPS)", ok: l.secure, detail: l.secure ? undefined : "پوش و نصب فقط روی HTTPS (یا localhost) کار می‌کند" },
    { label: "اتصال اینترنت", ok: l.online },
    { label: "مرورگر از سرویس‌ورکر و پوش پشتیبانی می‌کند", ok: l.swSupported && l.pushManager, detail: l.support.state === "ready" ? undefined : (l.support as { reason?: string }).reason },
    { label: `نصب‌شده / حالت مستقل (${l.platform.os === "ios" ? "برای iOS الزامی است" : "اختیاری"})`, ok: l.platform.os === "ios" ? l.standalone : l.standalone ? true : null },
    { label: `مجوز اعلان: ${PERMISSION_FA[l.permission] ?? l.permission}`, ok: l.permission === "granted" ? true : l.permission === "denied" ? false : null },
    { label: "سرویس‌ورکر ثبت و فعال است", ok: l.swRegistered && l.swActive, detail: l.swScope ? `scope: ${l.swScope}` : "در حالت توسعه‌ی محلی عمداً غیرفعال است" },
    { label: "کلید VAPID روی سرور تنظیم شده", ok: s ? s.configured : null },
    { label: "این دستگاه اشتراک پوش دارد", ok: l.endpoint ? true : false, detail: l.optedOut ? "شما پوش این دستگاه را دستی خاموش کرده‌اید" : undefined },
    { label: "اشتراک روی سرور ثبت است", ok: s && l.endpoint ? s.currentRegistered : null, detail: l.endpoint && s && !s.currentRegistered ? "«اصلاح خودکار» را بزنید" : undefined },
    { label: "کلید اشتراک با کلید فعلی سرور یکی است", ok: l.keyMatchesServer },
  ];
  return checks;
}

export default function PushDiagnosticsPage() {
  const [local, setLocal] = useState<LocalPushDiagnostics | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [attempts, setAttempts] = useState<PushAttemptRow[] | null>(null);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { state: test, start } = usePushTest();

  const load = useCallback(async () => {
    const key = await fetchPushVapidKey().catch(() => ({ publicKey: null }));
    const l = await collectLocalDiagnostics(key.publicKey);
    setLocal(l);
    const [s, a] = await Promise.all([fetchPushStatus(l.endpoint ?? undefined).catch(() => null), fetchPushAttempts().catch(() => null)]);
    setStatus(s);
    setAttempts(a?.items ?? []);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function repair() {
    setBusy(true);
    setRepairMsg(null);
    const out = await autoRepairPush();
    setRepairMsg(
      out.ok
        ? "اشتراک این دستگاه دوباره ساخته و ثبت شد ✓"
        : out.reason === "denied"
          ? "اعلان مسدود است؛ ابتدا طبق راهنمای پایین مجوز را باز کنید."
          : (out.detail ?? "اصلاح انجام نشد؛ راهنمای بخش‌های بالا را دنبال کنید."),
    );
    await load();
    setBusy(false);
  }

  const checks = local ? buildChecks(local, status) : [];
  const current = status?.devices.find((d) => d.isCurrent);
  const verdict = describeTest(test);

  return (
    <div className="pb-10 max-w-[680px]">
      <Link href="/settings/notifications" className="text-[12px] text-primary font-bold">← اعلان‌ها</Link>
      <h1 className="text-xl font-extrabold mt-2">عیب‌یابی اعلان و پوش</h1>
      <p className="text-[13px] text-muted mt-1 leading-6">وضعیت واقعی همین دستگاه و سرور را بررسی می‌کنیم؛ اگر مشکلی هست راه‌حل را می‌بینید.</p>

      <Card className="mt-5 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[13px] font-bold">بررسی این دستگاه {local ? `(${local.platform.label})` : ""}</div>
          <button onClick={() => void load()} className="text-[11.5px] font-bold text-primary cursor-pointer">بررسی مجدد</button>
        </div>
        {!local ? (
          <div className="text-[12px] text-muted py-4">در حال بررسی…</div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {checks.map((c, i) => (
              <li key={i} className="py-2.5 flex items-start gap-2.5">
                <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center ${c.ok === true ? "bg-success-soft text-success" : c.ok === false ? "bg-danger-soft text-danger" : "bg-slate-100 text-muted"}`}>
                  {c.ok === true ? "✓" : c.ok === false ? "✕" : "–"}
                </span>
                <div className="text-[12.5px] leading-6">
                  {c.label}
                  {c.detail ? <div className="text-[11.5px] text-muted">{c.detail}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {local?.permission === "denied" ? (
          <div className="mt-3 text-[12px] bg-danger-soft text-danger rounded-xl p-3 leading-6">
            <div className="font-bold mb-1">اعلان برای این سایت مسدود است</div>
            <ol className="list-decimal ps-5">{deniedRecoverySteps(local.platform).map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        ) : null}
        {local && local.support.state !== "ready" ? <div className="mt-3 text-[12px] bg-warning-soft text-warning rounded-xl p-3 leading-6">{(local.support as { reason: string }).reason}</div> : null}
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={repair} disabled={busy} className="text-[12px] font-bold bg-primary text-white rounded-lg px-3 py-2 cursor-pointer disabled:opacity-50">
            {busy ? "در حال اصلاح…" : "اصلاح خودکار (ساخت دوباره‌ی اشتراک)"}
          </button>
          <button onClick={() => current && start(current.id)} disabled={!current || test.phase === "sending"} className="text-[12px] font-bold bg-primary-soft text-primary rounded-lg px-3 py-2 cursor-pointer disabled:opacity-50">
            ارسال آزمایشی
          </button>
        </div>
        {repairMsg ? <div className="mt-2 text-[12px] text-ink-soft">{repairMsg}</div> : null}
        {verdict ? <div className="mt-3 text-[12px] leading-6 rounded-xl p-3 bg-slate-50" role="status">{verdict.text}</div> : null}
      </Card>

      <Card className="mt-5 p-4">
        <div className="text-[13px] font-bold mb-2">آخرین ارسال موفق هر دستگاه</div>
        {!status || status.devices.length === 0 ? (
          <div className="text-[12px] text-muted">دستگاهی ثبت نشده است.</div>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {status.devices.map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span>{d.label}{d.isCurrent ? " (این دستگاه)" : ""}</span>
                <span className="text-muted">{d.lastSuccessAt ? formatJalaliDateTime(d.lastSuccessAt) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5 p-4">
        <div className="text-[13px] font-bold mb-2">۲۰ تلاش اخیر ارسال</div>
        {attempts === null ? (
          <div className="text-[12px] text-muted">در حال بارگذاری…</div>
        ) : attempts.length === 0 ? (
          <div className="text-[12px] text-muted">هنوز تلاشی ثبت نشده است.</div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {attempts.map((a) => (
              <li key={a.id} className="py-2.5 text-[12px] leading-6">
                <div className="flex justify-between gap-2">
                  <span className="font-bold">{a.device}{a.channel === "sms" ? " (پیامک)" : ""}</span>
                  <span className="text-muted">{formatJalaliDateTime(a.createdAt)}</span>
                </div>
                <div className={a.status === "sent" ? "text-success" : a.status === "skipped" ? "text-warning" : "text-danger"}>
                  {a.status === "sent" ? "ارسال شد" : a.status === "skipped" ? "رد شد" : a.status === "expired" ? "منقضی" : "ناموفق"}
                  {a.httpCode ? ` · کد ${toPersianDigits(a.httpCode)}` : ""}
                  {a.reason && a.reason !== "ok" ? ` · ${a.explanation}` : ""}
                  {a.deliveredAt ? " · رسید دستگاه ✓" : a.status === "sent" ? " · رسیدی نرسیده" : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5 p-4">
        <div className="text-[13px] font-bold mb-2">نکات دستگاه</div>
        <ul className="list-disc ps-5 text-[12px] leading-7 text-ink-soft">
          <li>حالت «صرفه‌جویی باتری» یا «بهینه‌سازی باتری» اندروید (به‌ویژه Samsung/Xiaomi/Huawei) می‌تواند اعلان برنامه‌های بسته را به تأخیر بیندازد؛ اکسیر را از بهینه‌سازی مستثنا کنید.</li>
          <li>«مزاحم نشوید / Focus» روشن باشد، اعلان بی‌صدا یا مخفی می‌شود.</li>
          <li>روی آیفون فقط برنامه‌ی نصب‌شده روی صفحه‌ی اصلی اعلان می‌گیرد (iOS ۱۶٫۴ به بالا).</li>
          <li>در مرورگرهای درون‌برنامه‌ای (اینستاگرام، تلگرام و …) پوش کار نمی‌کند؛ در مرورگر اصلی باز کنید.</li>
          <li>VPN/فیلترشکن یا شبکه‌های محدود ممکن است به سرویس پوش گوگل/اپل/موزیلا دسترسی نداشته باشند؛ با اینترنت دیگر امتحان کنید.</li>
        </ul>
      </Card>
    </div>
  );
}
