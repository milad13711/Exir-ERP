"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import {
  fetchNavatelCdr,
  fetchNavatelStats,
  fetchNavatelVoicemails,
  fetchNavatelVoicemailMessages,
  fetchNavatelAudioUrl,
  ApiError,
  type NavatelCdrItem,
  type NavatelOperatorStat,
  type NavatelVoicemailBox,
  type NavatelVoicemailMessage,
} from "@/lib/api";

const CALL_TYPES: Record<string, string> = {
  enterprise_did: "ورودی",
  enterprise_out: "خروجی",
  divert: "انتقالی",
  internal: "داخلی",
};
const CAUSES: Record<string, string> = {
  NORMAL_CLEARING: "پاسخ داده شد",
  NO_ANSWER: "بدون پاسخ",
  ORIGINATOR_CANCEL: "قطع توسط تماس‌گیرنده",
  CALL_REJECTED: "رد شده توسط اپراتور",
  RECOVERY_ON_TIMER_EXPIRE: "عدم برقراری ارتباط",
  BAD_IDENTITY_INFO: "ورودی نامعتبر",
  NORMAL_UNSPECIFIED: "عادی",
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function AudioButton({ fileName }: { fileName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUrl(await fetchNavatelAudioUrl(fileName));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "پخش ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  if (url) return <audio src={url} controls autoPlay className="h-8 max-w-[220px]" />;
  return (
    <button type="button" onClick={load} disabled={loading} className="text-[11.5px] font-bold text-primary cursor-pointer disabled:opacity-50">
      {loading ? "..." : error ?? "▶ پخش مکالمه"}
    </button>
  );
}

function RangeBar({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex items-end gap-3 flex-wrap mb-4">
      <div className="w-[170px]">
        <div className="text-[11.5px] text-muted mb-1">از تاریخ</div>
        <JalaliDateInput value={from} onChange={setFrom} placeholder="از تاریخ" />
      </div>
      <div className="w-[170px]">
        <div className="text-[11.5px] text-muted mb-1">تا تاریخ</div>
        <JalaliDateInput value={to} onChange={setTo} placeholder="تا تاریخ" />
      </div>
    </div>
  );
}

function CdrTab() {
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(todayIso);
  const [callType, setCallType] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: NavatelCdrItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNavatelCdr(from, to, offset, callType)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setData({ total: 0, items: [] });
          setError(err instanceof ApiError ? err.message : "دریافت گزارش ناموفق بود");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, offset, callType]);

  return (
    <div>
      <RangeBar from={from} to={to} setFrom={(v) => { setOffset(0); setData(null); setFrom(v); }} setTo={(v) => { setOffset(0); setData(null); setTo(v); }} />
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[["", "همه"], ["enterprise_did", "ورودی"], ["enterprise_out", "خروجی"], ["divert", "انتقالی"], ["internal", "داخلی"]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setOffset(0); setData(null); setCallType(k); }}
            className={clsx("text-[12px] font-bold px-3.5 py-1.5 rounded-[10px] cursor-pointer", callType === k ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <div className="text-[12.5px] text-danger mb-3">{error}</div> : null}
      <Card className="overflow-hidden">
        {data === null ? (
          <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : data.items.length === 0 ? (
          <div className="py-10 text-center text-muted text-sm">تماسی در این بازه ثبت نشده</div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {data.items.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1 basis-[200px]">
                  <div className="text-[13px] font-bold" dir="ltr">{r.caller} ← {r.destination}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDateTime(r.setupTime.replace(" ", "T"))}</div>
                </div>
                <Badge tone="neutral">{CALL_TYPES[r.callType] ?? r.callType}</Badge>
                <Badge tone={r.cause === "NORMAL_CLEARING" ? "success" : "warning"}>{r.cause ? CAUSES[r.cause] ?? r.cause : "—"}</Badge>
                <span className="text-[11.5px] text-muted" dir="ltr">{fmtDuration(r.durationSeconds)}</span>
                {r.recPath ? <AudioButton fileName={r.recPath} /> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
      {data && data.total > 20 ? (
        <div className="flex items-center justify-between mt-3 text-[12px]">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))} className="font-bold text-primary disabled:opacity-40 cursor-pointer">قبلی</button>
          <span className="text-muted">
            {toPersianDigits(offset + 1)}–{toPersianDigits(Math.min(offset + 20, data.total))} از {toPersianDigits(data.total)}
          </span>
          <button disabled={offset + 20 >= data.total} onClick={() => setOffset(offset + 20)} className="font-bold text-primary disabled:opacity-40 cursor-pointer">بعدی</button>
        </div>
      ) : null}
    </div>
  );
}

function StatsTab() {
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(todayIso);
  const [rows, setRows] = useState<NavatelOperatorStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNavatelStats(from, to)
      .then((d) => !cancelled && (setRows(d), setError(null)))
      .catch((err) => !cancelled && (setRows([]), setError(err instanceof ApiError ? err.message : "دریافت آمار ناموفق بود")));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return (
    <div>
      <RangeBar from={from} to={to} setFrom={(v) => { setRows(null); setFrom(v); }} setTo={(v) => { setRows(null); setTo(v); }} />
      {error ? <div className="text-[12.5px] text-danger mb-3">{error}</div> : null}
      <Card className="overflow-hidden">
        {rows === null ? (
          <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted text-sm">آماری در این بازه نیست</div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {rows.map((r) => (
              <div key={r.operator} className="px-4 py-3 flex items-center gap-4 flex-wrap">
                <div className="text-[13px] font-bold flex-1 basis-[150px]" dir="ltr">{r.operator}</div>
                <div className="text-[12px]">خارجی: <b>{toPersianDigits(r.externalCalls)}</b> تماس · {toPersianDigits(Math.round(r.externalSeconds / 60))} دقیقه</div>
                <div className="text-[12px]">داخلی: <b>{toPersianDigits(r.internalCalls)}</b> تماس · {toPersianDigits(Math.round(r.internalSeconds / 60))} دقیقه</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function VoicemailTab() {
  const [boxes, setBoxes] = useState<NavatelVoicemailBox[] | null>(null);
  const [openBox, setOpenBox] = useState<string | null>(null);
  const [messages, setMessages] = useState<NavatelVoicemailMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNavatelVoicemails()
      .then(setBoxes)
      .catch((err) => {
        setBoxes([]);
        setError(err instanceof ApiError ? err.message : "دریافت صندوق‌های صوتی ناموفق بود");
      });
  }, []);

  function open(uuid: string) {
    setOpenBox(uuid);
    setMessages(null);
    fetchNavatelVoicemailMessages(uuid).then(setMessages).catch(() => setMessages([]));
  }

  return (
    <div>
      {error ? <div className="text-[12.5px] text-danger mb-3">{error}</div> : null}
      <Card className="overflow-hidden">
        {boxes === null ? (
          <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : boxes.length === 0 ? (
          <div className="py-10 text-center text-muted text-sm">صندوق صوتی تعریف نشده</div>
        ) : (
          boxes.map((b) => (
            <div key={b.uuid} className="border-b border-border last:border-b-0">
              <button onClick={() => open(b.uuid)} className="w-full flex items-center justify-between px-4 py-3 text-right cursor-pointer">
                <span className="text-[13px] font-bold">صندوق {b.boxId}</span>
                <Badge tone={b.enabled ? "success" : "neutral"}>{b.enabled ? "فعال" : "غیرفعال"}</Badge>
              </button>
              {openBox === b.uuid ? (
                <div className="px-4 pb-3 flex flex-col gap-2">
                  {messages === null ? (
                    <div className="text-[12px] text-muted">در حال بارگذاری...</div>
                  ) : messages.length === 0 ? (
                    <div className="text-[12px] text-muted">پیامی نیست</div>
                  ) : (
                    messages.map((m) => (
                      <div key={m.uuid} className="flex items-center gap-3 flex-wrap bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-[12.5px] font-bold" dir="ltr">{m.callerNumber}</span>
                        <span className="text-[11.5px] text-muted">{formatJalaliDateTime(m.createdAt)}</span>
                        <span className="text-[11.5px] text-muted" dir="ltr">{fmtDuration(m.lengthSeconds)}</span>
                        <AudioButton fileName={`${m.uuid}.mp3`} />
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

/** گزارش‌های خودِ سانترال نواتل (CDR، آمار اپراتورها، صندوق صوتی) — طبق مستند رسمی CCaaS API نواتل. */
export function NavatelReports() {
  const [tab, setTab] = useState<"cdr" | "stats" | "voicemail">("cdr");
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {([["cdr", "رکورد مکالمات"], ["stats", "عملکرد اپراتورها"], ["voicemail", "صندوق صوتی"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx("text-[12px] font-bold px-3.5 py-1.5 rounded-[10px] cursor-pointer", tab === k ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "cdr" ? <CdrTab /> : tab === "stats" ? <StatsTab /> : <VoicemailTab />}
    </div>
  );
}
