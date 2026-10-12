"use client";

import { useEffect, useRef, useState } from "react";
import { fetchMessengerMediaBlob, type MessengerMedia } from "@/lib/messenger-api";
import { formatBytes } from "@/lib/media";
import { toPersianDigits } from "@/lib/persian";
import { formatDuration, isAudio, voiceSecondsFromName } from "./utils";

const urlCache = new Map<string, string>();

function hoursLeft(m: MessengerMedia): number {
  return Math.max(0, Math.ceil((new Date(m.expiresAt).getTime() - Date.now()) / 3_600_000));
}

async function saveToDevice(m: MessengerMedia) {
  const blob = await fetchMessengerMediaBlob(m.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function loadInline(m: MessengerMedia): Promise<string> {
  const cached = urlCache.get(m.id);
  if (cached) return cached;
  const u = URL.createObjectURL(await fetchMessengerMediaBlob(m.id, true));
  urlCache.set(m.id, u);
  return u;
}

/** رسانه‌ی پیام: پیش‌نمایش/چیپ فایل/پخش‌کننده‌ی صدا + شمارش معکوس حذف + دانلود. پس از ۲۴ ساعت فقط برچسب «فایل منقضی شد». */
export function MediaBlock({ media, mine }: { media: MessengerMedia; mine: boolean }) {
  const [src, setSrc] = useState<string | null>(urlCache.get(media.id) ?? null);
  const [viewer, setViewer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLocal = media.id.startsWith("local-");
  const expired = !isLocal && (media.expired || hoursLeft(media) === 0);
  const left = hoursLeft(media);
  const audio = isAudio(media);

  useEffect(() => {
    if (isLocal || expired || media.kind !== "IMAGE" || src) return;
    let alive = true;
    loadInline(media)
      .then((u) => alive && setSrc(u))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [media, isLocal, expired, src]);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer]);

  if (isLocal) {
    return (
      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] ${mine ? "bg-white/15" : "bg-slate-50 border border-border"}`}>
        <span aria-hidden>{audio ? "🎤" : media.kind === "IMAGE" ? "📷" : media.kind === "VIDEO" ? "🎞" : "📎"}</span>
        <span className="truncate max-w-[180px]" dir="auto">{audio ? "پیام صوتی" : media.fileName}</span>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[12.5px] text-muted">
        <span aria-hidden>⌛</span> فایل منقضی شد
        <span className="text-[11px] opacity-70 truncate max-w-[140px]" dir="auto">{audio ? "پیام صوتی" : media.fileName}</span>
      </div>
    );
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await saveToDevice(media);
    } catch (e) {
      setError(e instanceof Error ? e.message : "دانلود ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function openViewer() {
    setError(null);
    if (!src) {
      setBusy(true);
      try {
        setSrc(await loadInline(media));
      } catch (e) {
        setError(e instanceof Error ? e.message : "پخش ناموفق بود");
        return;
      } finally {
        setBusy(false);
      }
    }
    setViewer(true);
  }

  return (
    <div className="max-w-[260px]">
      {audio ? (
        <VoicePlayer media={media} mine={mine} />
      ) : media.kind === "IMAGE" ? (
        src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={media.fileName} onClick={() => setViewer(true)} className="rounded-xl max-h-[240px] w-auto cursor-zoom-in object-cover" />
        ) : (
          <div className="w-[200px] h-[120px] rounded-xl bg-black/5 animate-pulse" />
        )
      ) : (
        <button
          type="button"
          onClick={media.kind === "VIDEO" ? () => void openViewer() : undefined}
          disabled={busy}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-start ${mine ? "bg-white/15" : "bg-slate-50 border border-border"} ${media.kind === "VIDEO" ? "cursor-pointer" : "cursor-default"}`}
        >
          <div className="text-xl" aria-hidden>{media.kind === "VIDEO" ? "▶️" : "📎"}</div>
          <div className="min-w-0">
            <div className="text-[13px] font-bold truncate" dir="auto">{media.fileName}</div>
            <div className="text-[11px] opacity-70">{toPersianDigits(formatBytes(media.size))}</div>
          </div>
        </button>
      )}
      <div className={`mt-1 flex items-center justify-between gap-2 text-[11px] ${mine ? "text-white/80" : "text-muted"}`}>
        <span title="فایل‌ها فقط ۲۴ ساعت نگهداری می‌شوند">⏳ {toPersianDigits(left)} ساعت تا حذف</span>
        <button type="button" onClick={download} disabled={busy} className="font-bold underline cursor-pointer disabled:opacity-50">
          {busy ? "…" : "دانلود"}
        </button>
      </div>
      {error ? <div className="text-[11px] text-danger mt-0.5">{error}</div> : null}
      {viewer && src ? (
        <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" role="dialog" aria-label={media.fileName} onClick={() => setViewer(false)}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold truncate" dir="auto">{media.fileName}</div>
              <div className="text-[11.5px] opacity-70">⏳ {toPersianDigits(left)} ساعت تا حذف — برای نگهداری دائم دانلود کنید</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={download} disabled={busy} className="bg-white/15 hover:bg-white/25 rounded-xl px-3.5 py-2 text-[13px] font-bold cursor-pointer">⬇ دانلود</button>
              <button type="button" onClick={() => setViewer(false)} className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 text-lg cursor-pointer" aria-label="بستن">✕</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
            {media.kind === "VIDEO" ? (
              <video src={src} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={media.fileName} className="max-h-full max-w-full object-contain rounded-lg" />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** پخش‌کننده‌ی ساده‌ی پیام صوتی: پخش/توقف، نوار پیشرفت و زمان. */
function VoicePlayer({ media, mine }: { media: MessengerMedia; mine: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(urlCache.get(media.id) ?? null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(voiceSecondsFromName(media.fileName) ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoPlay = useRef(false);

  useEffect(() => {
    if (src && autoPlay.current) {
      autoPlay.current = false;
      void ref.current?.play().catch(() => undefined);
    }
  }, [src]);

  async function toggle() {
    setErr(null);
    if (!src) {
      setBusy(true);
      try {
        autoPlay.current = true;
        setSrc(await loadInline(media));
      } catch (e) {
        autoPlay.current = false;
        setErr(e instanceof Error ? e.message : "پخش ناموفق بود");
      } finally {
        setBusy(false);
      }
      return;
    }
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setErr("پخش ناموفق بود"));
    else a.pause();
  }

  const total = dur || 0;
  return (
    <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 min-w-[210px] ${mine ? "bg-white/15" : "bg-slate-50 border border-border"}`}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50 ${mine ? "bg-white text-primary" : "bg-primary text-white"}`}
        aria-label={playing ? "توقف" : "پخش پیام صوتی"}
      >
        {busy ? "…" : playing ? "❚❚" : "▶"}
      </button>
      <div className="flex-1 min-w-0" dir="ltr">
        <input
          type="range"
          min={0}
          max={Math.max(total, pos, 1)}
          step={0.1}
          value={pos}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPos(v);
            if (ref.current) ref.current.currentTime = v;
          }}
          className="w-full accent-current h-1 cursor-pointer"
          aria-label="موقعیت پخش"
        />
        <div className="text-[10.5px] opacity-75 mt-0.5 flex justify-between">
          <span>{formatDuration(playing || pos > 0 ? pos : total)}</span>
          <span>{total ? formatDuration(total) : ""}</span>
        </div>
      </div>
      {src ? (
        <audio
          ref={ref}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDur(d);
          }}
        />
      ) : null}
      {err ? <span className="text-[10.5px] text-danger">{err}</span> : null}
    </div>
  );
}
