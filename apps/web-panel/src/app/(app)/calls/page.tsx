"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PhoneIcon } from "@/components/icons";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchCallLogs, originateCall, ApiError, type CallLog, type CallDirection } from "@/lib/api";
import { ModuleHelp } from "@/components/ui/ModuleHelp";

const STATUS_LABEL: Record<CallLog["status"], string> = {
  RINGING: "در حال زنگ خوردن",
  ANSWERED: "پاسخ‌داده‌شده",
  MISSED: "از دست رفته",
  NO_ANSWER: "بی‌پاسخ",
  FAILED: "ناموفق",
};

type DirectionFilter = "همه" | CallDirection;

export default function CallHistoryPage() {
  const [logs, setLogs] = useState<CallLog[] | null>(null);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("همه");
  const [error, setError] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);

  function reload() {
    fetchCallLogs({ limit: 200 }).then(setLogs).catch(() => setLogs([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter((l) => directionFilter === "همه" || l.direction === directionFilter);
  }, [logs, directionFilter]);

  const missedCount = useMemo(
    () => (logs ?? []).filter((l) => l.direction === "INBOUND" && (l.status === "MISSED" || l.status === "NO_ANSWER")).length,
    [logs],
  );

  async function handleRedial(log: CallLog) {
    const number = log.direction === "INBOUND" ? log.fromNumber : log.toNumber;
    setCallingId(log.id);
    setError(null);
    try {
      await originateCall(number, log.contactId ?? undefined);
      setTimeout(reload, 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "برقراری تماس ناموفق بود");
    } finally {
      setCallingId(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">تاریخچه تماس‌ها</h1>
            <ModuleHelp code="voip" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            همه‌ی تماس‌های ورودی و خروجی ثبت‌شده در محیط کاری
            {missedCount > 0 ? (
              <span className="text-danger font-bold"> — {toPersianDigits(missedCount)} تماس از دست رفته</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-5 mb-4">
        {(["همه", "INBOUND", "OUTBOUND"] as DirectionFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setDirectionFilter(f)}
            className={clsx(
              "text-[12px] font-bold px-3.5 py-1.5 rounded-[10px] cursor-pointer",
              directionFilter === f ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {f === "همه" ? "همه" : f === "INBOUND" ? "ورودی" : "خروجی"}
          </button>
        ))}
      </div>

      {error ? <div className="text-[12.5px] text-danger mb-3">{error}</div> : null}

      <Card className="overflow-hidden">
        {logs === null ? (
          <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-muted text-sm">تماسی ثبت نشده</div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {filtered.map((log) => {
              const missed = log.direction === "INBOUND" && (log.status === "MISSED" || log.status === "NO_ANSWER");
              const label = log.contact?.name ?? log.contact?.company ?? (log.direction === "INBOUND" ? log.fromNumber : log.toNumber);
              const number = log.direction === "INBOUND" ? log.fromNumber : log.toNumber;
              return (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className={clsx(
                      "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                      missed ? "bg-danger-soft text-danger" : log.direction === "INBOUND" ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
                    )}
                  >
                    <PhoneIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold truncate">{label}</div>
                    <div className="text-[11.5px] text-muted mt-0.5" dir="ltr">
                      {number}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="text-[11.5px] text-muted">{formatJalaliDateTime(log.startedAt)}</div>
                    <div className="flex items-center justify-end gap-1.5 mt-1">
                      {log.durationSeconds != null ? (
                        <span className="text-[11px] text-muted" dir="ltr">
                          {Math.floor(log.durationSeconds / 60)}:{String(log.durationSeconds % 60).padStart(2, "0")}
                        </span>
                      ) : null}
                      <Badge tone={missed ? "danger" : log.status === "ANSWERED" ? "success" : "neutral"}>
                        {missed ? "از دست رفته" : STATUS_LABEL[log.status]}
                      </Badge>
                      {log.recordingUrl ? (
                        <a href={log.recordingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-primary" title="پخش ضبط مکالمه">
                          ▶
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRedial(log)}
                    disabled={callingId === log.id}
                    className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 hover:bg-primary-soft text-ink-soft hover:text-primary flex items-center justify-center cursor-pointer disabled:opacity-50"
                    title="تماس مجدد"
                  >
                    <PhoneIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
