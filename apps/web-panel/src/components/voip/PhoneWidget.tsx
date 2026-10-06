"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { PhoneIcon, SearchIcon, CloseIcon } from "@/components/icons";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import { getVoipSocket } from "@/lib/voip-socket";
import { originateCall, fetchVoipStatus, fetchCallLogs, fetchCrmContacts, ApiError, type CallLog, type CrmContact } from "@/lib/api";

type Tab = "dialpad" | "contacts" | "history";
const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export function PhoneWidget() {
  const { installedModules } = useWorkspace();
  const [open, setOpen] = useState(false);
  // null = هنوز نمی‌دانیم؛ تا مشخص نشده دکمه نشان داده نمی‌شود (به‌جای چشمک‌زدن).
  const [configured, setConfigured] = useState<boolean | null>(null);
  const voipInstalled = installedModules.has("voip");

  useEffect(() => {
    if (!voipInstalled) return;
    fetchVoipStatus()
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, [voipInstalled]);

  // ماژول نصب/فعال نیست، یا ارائه‌دهنده‌ی تلفن تنظیم نشده: دکمه‌ی تماس بی‌فایده است و نباید نشان داده شود.
  if (!voipInstalled || !configured) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-10 h-10 rounded-xl border border-border bg-white flex items-center justify-center text-primary cursor-pointer"
        aria-label="تلفن"
      >
        <PhoneIcon className="w-[18px] h-[18px]" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 end-0 z-50">
            <PhonePanel onClose={() => setOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function PhonePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("dialpad");
  const [number, setNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CallLog[] | null>(null);

  function reloadHistory() {
    fetchCallLogs({ mine: true, limit: 50 }).then(setHistory).catch(() => setHistory([]));
  }

  useEffect(() => {
    reloadHistory();
    const socket = getVoipSocket();
    if (!socket) return;
    socket.on("call.incoming", reloadHistory);
    socket.on("call.ended", reloadHistory);
    return () => {
      socket.off("call.incoming", reloadHistory);
      socket.off("call.ended", reloadHistory);
    };
  }, []);

  async function handleCall(toNumber: string, contactId?: string) {
    if (!toNumber.trim()) return;
    setCalling(true);
    setError(null);
    try {
      await originateCall(toNumber.trim(), contactId);
      setTimeout(reloadHistory, 1500);
      setNumber("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "برقراری تماس ناموفق بود");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="w-[320px] bg-surface border border-border rounded-2xl shadow-xl overflow-hidden flex flex-col" dir="rtl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-l from-primary to-primary/80">
        <span className="text-[13.5px] font-bold text-white">تلفن</span>
        <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer">
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 pt-3">
        {(
          [
            ["dialpad", "شماره‌گیر"],
            ["contacts", "مخاطبین"],
            ["history", "تاریخچه"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex-1 text-[11.5px] font-bold py-1.5 rounded-lg cursor-pointer",
              tab === key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-3.5">
        {error ? <div className="text-[11.5px] text-danger mb-2.5">{error}</div> : null}

        {tab === "dialpad" ? (
          <div className="flex flex-col gap-3" dir="ltr">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^\d*#+]/g, ""))}
              placeholder="شماره را وارد کنید"
              dir="ltr"
              className="text-center text-lg font-bold outline-none bg-slate-50 border border-border rounded-xl py-2.5"
            />
            <div className="grid grid-cols-3 gap-2" dir="ltr">
              {KEYPAD.map((k) => (
                <button
                  key={k}
                  onClick={() => setNumber((n) => n + k)}
                  className="text-[15px] font-bold py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer"
                >
                  {toPersianDigits(k)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNumber((n) => n.slice(0, -1))}
                disabled={!number}
                className="w-10 h-10 shrink-0 rounded-full bg-slate-100 text-ink-soft text-[15px] cursor-pointer disabled:opacity-40"
                aria-label="حذف رقم آخر"
              >
                ⌫
              </button>
              <button
                onClick={() => handleCall(number)}
                disabled={calling || !number.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-success text-white font-bold text-[13px] cursor-pointer disabled:opacity-50"
              >
                <PhoneIcon className="w-4 h-4" />
                {calling ? "در حال برقراری..." : "برقراری تماس"}
              </button>
            </div>
          </div>
        ) : null}

        {tab === "contacts" ? <ContactsTab onCall={(num, id) => handleCall(num, id)} calling={calling} /> : null}

        {tab === "history" ? <HistoryTab logs={history} onCall={(num, id) => handleCall(num, id)} calling={calling} /> : null}
      </div>
    </div>
  );
}

function ContactsTab({ onCall, calling }: { onCall: (num: string, contactId?: string, contactName?: string) => void; calling: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CrmContact[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchCrmContacts(q.trim() || undefined)
        .then((r) => setResults(r.filter((c) => c.phone)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <SearchIcon className="w-3.5 h-3.5 text-muted absolute top-1/2 -translate-y-1/2 end-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجوی مخاطب..."
          className="w-full text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg pe-9 ps-3 py-2"
        />
      </div>
      <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
        {results === null ? (
          <div className="text-[12px] text-muted text-center py-4">در حال بارگذاری...</div>
        ) : results.length === 0 ? (
          <div className="text-[12px] text-muted text-center py-4">مخاطبی پیدا نشد</div>
        ) : (
          results.map((c) => (
            <button
              key={c.id}
              onClick={() => onCall(c.phone!, c.id, c.name)}
              disabled={calling}
              className="flex items-center justify-between gap-2 bg-slate-50 hover:bg-primary-soft rounded-lg px-3 py-2 text-right cursor-pointer disabled:opacity-50"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold truncate">{c.name}</div>
                <div className="text-[11px] text-muted" dir="ltr">
                  {c.phone}
                </div>
              </div>
              <PhoneIcon className="w-4 h-4 text-success shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<CallLog["status"], string> = {
  RINGING: "در حال زنگ خوردن",
  ANSWERED: "پاسخ‌داده‌شده",
  MISSED: "از دست رفته",
  NO_ANSWER: "بی‌پاسخ",
  FAILED: "ناموفق",
};

function HistoryTab({ logs, onCall, calling }: { logs: CallLog[] | null; onCall: (num: string, contactId?: string, contactName?: string) => void; calling: boolean }) {
  const rows = useMemo(() => logs ?? [], [logs]);

  return (
    <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto">
      {logs === null ? (
        <div className="text-[12px] text-muted text-center py-4">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-muted text-center py-4">هنوز تماسی ثبت نشده</div>
      ) : (
        rows.map((log) => {
          const missed = log.direction === "INBOUND" && (log.status === "MISSED" || log.status === "NO_ANSWER");
          const label = log.contact?.name ?? log.contact?.company ?? (log.direction === "INBOUND" ? log.fromNumber : log.toNumber);
          const number = log.direction === "INBOUND" ? log.fromNumber : log.toNumber;
          return (
            <div
              key={log.id}
              role="button"
              tabIndex={0}
              onClick={() => !calling && onCall(number, log.contactId ?? undefined, log.contact?.name)}
              onKeyDown={(e) => e.key === "Enter" && !calling && onCall(number, log.contactId ?? undefined, log.contact?.name)}
              className={clsx(
                "flex items-center gap-2.5 bg-slate-50 hover:bg-primary-soft rounded-lg px-3 py-2 text-right cursor-pointer",
                calling && "opacity-50 pointer-events-none",
              )}
            >
              <div
                className={clsx(
                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0 rotate-0",
                  missed ? "bg-danger-soft text-danger" : log.direction === "INBOUND" ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
                )}
                style={{ transform: log.direction === "OUTBOUND" ? "rotate(90deg)" : log.direction === "INBOUND" && !missed ? "rotate(180deg)" : undefined }}
              >
                <PhoneIcon className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold truncate">{label}</div>
                <div className="text-[10.5px] text-muted mt-0.5">
                  {missed ? "از دست رفته" : STATUS_LABEL[log.status]} · {formatJalaliDateTime(log.startedAt)}
                </div>
              </div>
              {log.durationSeconds != null ? (
                <span className="text-[10.5px] text-muted shrink-0" dir="ltr">
                  {Math.floor(log.durationSeconds / 60)}:{String(log.durationSeconds % 60).padStart(2, "0")}
                </span>
              ) : null}
              {log.recordingUrl ? (
                <a
                  href={log.recordingUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] font-bold text-primary shrink-0"
                  title="پخش ضبط مکالمه"
                >
                  ▶
                </a>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
