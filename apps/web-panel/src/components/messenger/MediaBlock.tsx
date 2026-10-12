"use client";

import { useEffect, useState } from "react";
import { fetchMessengerMediaBlob, type MessengerMedia } from "@/lib/messenger-api";
import { formatBytes } from "@/lib/media";
import { toPersianDigits } from "@/lib/persian";
import { Modal } from "@/components/ui/Modal";

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

/** رسانه‌ی پیام: پیش‌نمایش/چیپ فایل + شمارش معکوس حذف + دانلود. پس از ۲۴ ساعت فقط برچسب «فایل منقضی شد». */
export function MediaBlock({ media, mine }: { media: MessengerMedia; mine: boolean }) {
  const [src, setSrc] = useState<string | null>(urlCache.get(media.id) ?? null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const expired = media.expired || hoursLeft(media) === 0;
  const left = hoursLeft(media);

  useEffect(() => {
    if (expired || media.kind !== "IMAGE" || src) return;
    let alive = true;
    fetchMessengerMediaBlob(media.id, true)
      .then((b) => {
        const u = URL.createObjectURL(b);
        urlCache.set(media.id, u);
        if (alive) setSrc(u);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [media.id, media.kind, expired, src]);

  if (expired) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[12.5px] text-muted">
        <span aria-hidden>⌛</span> فایل منقضی شد
        <span className="text-[11px] opacity-70 truncate max-w-[140px]" dir="auto">{media.fileName}</span>
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

  async function playVideo() {
    setBusy(true);
    try {
      const b = await fetchMessengerMediaBlob(media.id, true);
      const u = URL.createObjectURL(b);
      urlCache.set(media.id, u);
      setSrc(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "پخش ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[260px]">
      {media.kind === "IMAGE" ? (
        src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={media.fileName} onClick={() => setPreview(true)} className="rounded-xl max-h-[240px] w-auto cursor-zoom-in object-cover" />
        ) : (
          <div className="w-[200px] h-[120px] rounded-xl bg-black/5 animate-pulse" />
        )
      ) : media.kind === "VIDEO" && src ? (
        <video src={src} controls className="rounded-xl max-h-[240px] w-full" />
      ) : (
        <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${mine ? "bg-white/15" : "bg-slate-50 border border-border"}`}>
          <div className="text-xl" aria-hidden>{media.kind === "VIDEO" ? "🎞" : "📎"}</div>
          <div className="min-w-0">
            <div className="text-[13px] font-bold truncate" dir="auto">{media.fileName}</div>
            <div className="text-[11px] opacity-70">{toPersianDigits(formatBytes(media.size))}</div>
          </div>
          {media.kind === "VIDEO" ? (
            <button type="button" onClick={playVideo} disabled={busy} className="ms-1 text-[12px] font-bold underline cursor-pointer disabled:opacity-50">
              پخش
            </button>
          ) : null}
        </div>
      )}
      <div className={`mt-1 flex items-center justify-between gap-2 text-[11px] ${mine ? "text-white/80" : "text-muted"}`}>
        <span title="فایل‌ها فقط ۲۴ ساعت نگهداری می‌شوند">⏳ {toPersianDigits(left)} ساعت تا حذف</span>
        <button type="button" onClick={download} disabled={busy} className="font-bold underline cursor-pointer disabled:opacity-50">
          {busy ? "…" : "دانلود"}
        </button>
      </div>
      {error ? <div className="text-[11px] text-danger mt-0.5">{error}</div> : null}
      {preview && src ? (
        <Modal title={media.fileName} onClose={() => setPreview(false)} width="max-w-[820px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={media.fileName} className="max-h-[70vh] mx-auto rounded-lg" />
          <div className="mt-3 flex items-center justify-between text-[12.5px]">
            <span className="text-muted">⏳ {toPersianDigits(left)} ساعت تا حذف — برای نگهداری دائم دانلود کنید.</span>
            <button type="button" onClick={download} className="bg-primary text-white font-bold px-4 py-2 rounded-xl cursor-pointer">دانلود</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
