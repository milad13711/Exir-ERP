"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPushStatus, removePushDevice, renamePushDevice, type PushStatus } from "@/lib/api";
import { getReadyRegistration } from "@/lib/push-client";
import { describeTest, usePushTest } from "@/hooks/usePushTest";
import { formatJalaliDateTime } from "@/lib/persian";

export function PushDevicesPanel({ reloadKey = 0 }: { reloadKey?: number }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const { state: test, start } = usePushTest();

  const load = useCallback(async () => {
    try {
      const reg = await getReadyRegistration(2500);
      const sub = await reg?.pushManager.getSubscription();
      setStatus(await fetchPushStatus(sub?.endpoint));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, reloadKey]);

  const verdict = describeTest(test);
  const current = status?.devices.find((d) => d.isCurrent);

  async function rename(id: string, old: string) {
    const next = window.prompt("نام دستگاه", old)?.trim();
    if (next && next !== old) {
      await renamePushDevice(id, next).catch(() => undefined);
      await load();
    }
  }

  async function remove(id: string) {
    if (!window.confirm("این دستگاه از دریافت اعلان حذف شود؟")) return;
    await removePushDevice(id).catch(() => undefined);
    await load();
  }

  if (failed) return <div className="px-4 py-4 text-[12px] text-danger">دریافت فهرست دستگاه‌ها ناموفق بود.</div>;
  if (!status) return <div className="px-4 py-4 text-[12px] text-muted">در حال بارگذاری دستگاه‌ها…</div>;

  return (
    <div className="px-4 py-4">
      <div className="text-[13px] font-bold mb-0.5">دستگاه‌های دریافت اعلان</div>
      <div className="text-[11.5px] text-muted mb-3 leading-5">هر گوشی/مرورگری که پوش را روشن کرده این‌جا دیده می‌شود. می‌توانید چند دستگاه داشته باشید.</div>

      {status.devices.length === 0 ? (
        <div className="text-[12px] text-muted bg-slate-50 rounded-xl p-3">هنوز دستگاهی ثبت نشده است.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {status.devices.map((d) => (
            <li key={d.id} className="border border-border rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold break-words">
                    {d.label} {d.isCurrent ? <span className="text-[10.5px] text-primary bg-primary-soft rounded px-1.5 py-0.5 ms-1">این دستگاه</span> : null}
                  </div>
                  <div className="text-[11px] text-muted mt-1 leading-5">
                    {d.lastSuccessAt ? `آخرین ارسال موفق: ${formatJalaliDateTime(d.lastSuccessAt)}` : "هنوز ارسال موفقی ثبت نشده"}
                    {d.lastSeenAt ? ` · آخرین حضور: ${formatJalaliDateTime(d.lastSeenAt)}` : ""}
                  </div>
                  {d.lastRotateAt ? <div className="text-[11px] text-muted">آخرین چرخش خودکار اشتراک: {formatJalaliDateTime(d.lastRotateAt)}</div> : null}
                  {d.vapidMismatch ? <div className="text-[11px] text-danger mt-1">کلید سرور عوض شده؛ در همان دستگاه «عیب‌یابی ← اصلاح خودکار» را بزنید.</div> : null}
                  {d.failureCount > 0 ? <div className="text-[11px] text-warning mt-1">{d.failureCount} شکست پیاپی اخیر</div> : null}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => start(d.id)} className="text-[11px] font-bold text-primary cursor-pointer">آزمایش</button>
                  <button onClick={() => rename(d.id, d.label)} className="text-[11px] font-bold text-ink-soft cursor-pointer">نام</button>
                  <button onClick={() => remove(d.id)} className="text-[11px] font-bold text-danger cursor-pointer">حذف</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          disabled={!current || test.phase === "sending"}
          onClick={() => current && start(current.id)}
          className="text-[12px] font-bold bg-primary text-white rounded-lg px-3 py-2 cursor-pointer disabled:opacity-50"
        >
          ارسال اعلان آزمایشی به این دستگاه
        </button>
        <button
          disabled={status.devices.length === 0 || test.phase === "sending"}
          onClick={() => start()}
          className="text-[12px] font-bold bg-primary-soft text-primary rounded-lg px-3 py-2 cursor-pointer disabled:opacity-50"
        >
          به همه‌ی دستگاه‌ها
        </button>
      </div>
      {!current && status.devices.length > 0 ? <div className="text-[11px] text-muted mt-2">این دستگاه روی سرور ثبت نیست؛ «پوش روی این دستگاه» را روشن کنید.</div> : null}
      {verdict ? (
        <div
          className={`mt-3 text-[12px] leading-6 rounded-xl p-3 ${
            verdict.tone === "ok" ? "bg-success-soft text-success" : verdict.tone === "bad" ? "bg-danger-soft text-danger" : verdict.tone === "warn" ? "bg-warning-soft text-warning" : "bg-slate-50 text-ink-soft"
          }`}
          role="status"
        >
          {verdict.text}
        </div>
      ) : null}
    </div>
  );
}
