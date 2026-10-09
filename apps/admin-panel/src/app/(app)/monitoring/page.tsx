"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ListSkeleton } from "@/components/ui/EmptyState";
import { BTN_GHOST, BTN_PRIMARY } from "@/components/ui/styles";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchMonitorStatus, runMonitorNow, sendMonitorTestAlert, type MonitorLevel, type MonitorStatusResponse } from "@/lib/api";

const LEVEL_LABEL: Record<MonitorLevel, string> = { ok: "سالم", warn: "هشدار", crit: "بحرانی", unknown: "نامشخص" };
const LEVEL_TONE = { ok: "success", warn: "warning", crit: "danger", unknown: "neutral" } as const;
const LEVEL_COLOR: Record<MonitorLevel, string> = { ok: "bg-success", warn: "bg-warning", crit: "bg-danger", unknown: "bg-muted" };
const SOURCE_LABEL = { checker: "برنامه", host: "میزبان", test: "آزمایشی" } as const;

/** نوار ۲۴ ساعت اخیر: هر ستون یک نمونه‌ی ۵ دقیقه‌ای. */
function Strip({ history, k }: { history: MonitorStatusResponse["history"]; k: string }) {
  const pts = history.filter((h) => h.levels[k]);
  if (pts.length === 0) return <div className="text-[11px] text-muted">بدون سابقه</div>;
  return (
    <div className="flex gap-px h-3 items-stretch" dir="ltr" aria-label="سابقه ۲۴ ساعت اخیر">
      {pts.map((h) => (
        <span key={h.at} title={`${formatJalaliDateTime(h.at)} — ${LEVEL_LABEL[h.levels[k]]}`} className={`flex-1 min-w-px rounded-[1px] ${LEVEL_COLOR[h.levels[k]]}`} />
      ))}
    </div>
  );
}

/** پایش و هشدار — فقط مدیر ارشد. بک‌اند هر ۵ دقیقه چک می‌کند و از طریق پیامک به مالک پلتفرم هشدار می‌دهد. */
export default function MonitoringPage() {
  const [data, setData] = useState<MonitorStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "run" | null>(null);

  const load = useCallback(() => {
    fetchMonitorStatus()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      const r = await sendMonitorTestAlert();
      setMsg(r.sent ? "هشدار آزمایشی ارسال شد؛ پیامک را روی گوشی بررسی کنید." : `ارسال نشد: ${r.reason === "no-recipient" ? "شماره‌ی دریافت هشدار تنظیم نشده" : r.reason === "cap" ? "سقف روزانه‌ی پیامک پر شده" : r.reason === "dedupe" ? "کمتر از یک دقیقه از آزمایش قبلی گذشته" : "پیامک ناموفق بود"}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy("run");
    try {
      await runMonitorNow();
      setTimeout(load, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(null);
    }
  }

  const shell = (children: React.ReactNode) => <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">{children}</div>;
  if (error && !data) return shell(<><PageHeader title="پایش و هشدار" /><p className="text-[13px] text-danger mt-6">{error}</p></>);
  if (!data) return shell(<><PageHeader title="پایش و هشدار" /><div className="mt-6"><ListSkeleton /></div></>);

  const worst: MonitorLevel = data.checks.some((c) => c.level === "crit") ? "crit" : data.checks.some((c) => c.level === "warn") ? "warn" : "ok";
  const cfg = data.config;
  return shell(
    <>
      <PageHeader title="پایش و هشدار" subtitle="چک خودکار هر ۵ دقیقه؛ هشدار فوری با پیامک به مالک پلتفرم" />

      <div className="flex gap-2 flex-wrap items-center mt-5">
        <Badge tone={LEVEL_TONE[worst]}>{worst === "ok" ? "همه‌چیز سالم است" : worst === "warn" ? "نیاز به توجه" : "مشکل بحرانی"}</Badge>
        <button className={BTN_PRIMARY} disabled={busy !== null} onClick={test}>
          {busy === "test" ? "در حال ارسال…" : "ارسال هشدار آزمایشی"}
        </button>
        <button className={BTN_GHOST} disabled={busy !== null} onClick={runNow}>
          اجرای چک‌ها همین حالا
        </button>
      </div>
      {msg && <p className="text-[12.5px] text-ink-soft mt-3">{msg}</p>}
      {error && <p className="text-[12.5px] text-danger mt-3">{error}</p>}

      {!cfg.alertPhoneConfigured && (
        <Card className="p-4 mt-5 border-warning">
          <div className="text-[13px] font-extrabold text-warning mb-1">گیرنده‌ی هشدار تنظیم نشده</div>
          <p className="text-[12.5px] text-ink-soft">یکی از متغیرهای MONITOR_ALERT_PHONE ، BACKUP_ALERT_PHONE یا ON_PREM_OWNER_PHONE را در .env سرور تنظیم کنید؛ بدون آن هشدار فقط در لاگ ثبت می‌شود.</p>
        </Card>
      )}
      {cfg.alertPhoneConfigured && !cfg.smsConfigured && (
        <Card className="p-4 mt-5 border-warning">
          <p className="text-[12.5px] text-ink-soft">پنل پیامک (EXIR_SMS_API_KEY) پیکربندی نشده؛ هشدار پیامکی ارسال نمی‌شود.</p>
        </Card>
      )}

      <div className="text-[13px] font-extrabold mt-6 mb-2">چک‌ها</div>
      <div className="flex flex-col gap-2">
        {data.checks.length === 0 && <Card className="p-4 text-[12.5px] text-muted">هنوز چکی اجرا نشده است (حداکثر ۵ دقیقه صبر کنید).</Card>}
        {data.checks.map((c) => (
          <Card key={c.key} className="p-3.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[13px] font-bold break-all">{c.label}</div>
              <Badge tone={LEVEL_TONE[c.level]}>{LEVEL_LABEL[c.level]}</Badge>
            </div>
            <div className="text-[12px] text-ink-soft mt-1.5">{c.detail}</div>
            <div className="mt-2"><Strip history={data.history} k={c.key} /></div>
            <div className="text-[11px] text-muted mt-1.5">
              از {formatJalaliDateTime(c.since)} · آخرین بررسی {formatJalaliDateTime(c.lastCheckedAt)}
            </div>
          </Card>
        ))}
        {data.backup && (
          <Card className="p-3.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[13px] font-bold">بکاپ و بازیابی</div>
              <Badge tone={data.backup.level === "ok" ? "success" : "warning"}>{data.backup.level === "ok" ? "سالم" : "هشدار"}</Badge>
            </div>
            {data.backup.warnings.length > 0 ? (
              <ul className="list-disc ps-5 mt-1.5 space-y-1 text-[12px] text-ink-soft">{data.backup.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            ) : (
              <div className="text-[12px] text-ink-soft mt-1.5">بکاپ‌ها تازه و رمزنگاری‌شده‌اند؛ جزئیات در صفحه‌ی «بکاپ و بازیابی».</div>
            )}
          </Card>
        )}
      </div>

      <div className="text-[13px] font-extrabold mt-6 mb-2">آخرین هشدارها</div>
      <Card className="p-4">
        {data.recent.length === 0 ? (
          <p className="text-[12.5px] text-muted">هشداری ارسال نشده است.</p>
        ) : (
          <ul className="space-y-2">
            {data.recent.map((r, i) => (
              <li key={i} className="text-[12.5px] flex flex-wrap gap-2 items-start">
                <Badge tone={r.delivered ? "success" : "neutral"}>{r.delivered ? "ارسال شد" : r.reason === "no-recipient" ? "بدون گیرنده" : "ارسال نشد"}</Badge>
                <Badge>{SOURCE_LABEL[r.source]}</Badge>
                <span className="text-muted">{formatJalaliDateTime(r.at)}</span>
                <span className="break-words">{r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="text-[13px] font-extrabold mt-6 mb-2">پیکربندی</div>
      <Card className="p-4 text-[12.5px] space-y-1.5 text-ink-soft">
        <div>گیرنده‌ی پیامک: <span dir="ltr">{cfg.alertPhoneMasked ?? "—"}</span> · امروز {toPersianDigits(cfg.smsSentToday)} از {toPersianDigits(cfg.maxSmsPerDay)} پیامک مجاز</div>
        <div>آدرس‌های پایش‌شده: <span dir="ltr" className="break-all">{cfg.urls.join(" , ") || "—"}</span></div>
        <div>میزبان‌های TLS: <span dir="ltr" className="break-all">{cfg.tlsHosts.join(" , ") || "—"}</span></div>
        <div>
          host-watch (میزبان):{" "}
          {cfg.internalAlertEnabled ? (data.hostHeartbeatAt ? `آخرین ضربان ${formatJalaliDateTime(data.hostHeartbeatAt)}` : "فعال در بک‌اند؛ هنوز ضربانی نرسیده") : "غیرفعال (INTERNAL_ALERT_TOKEN تنظیم نشده)"}
        </div>
        <div className="text-muted">پایش بیرونی (UptimeRobot/BetterStack) تنها راه تشخیص قطع کامل سرور است؛ راهنما: infra/hardening/monitoring/EXTERNAL-UPTIME.md</div>
      </Card>
    </>,
  );
}
