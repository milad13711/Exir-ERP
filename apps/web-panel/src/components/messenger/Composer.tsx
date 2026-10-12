"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SendIcon } from "@/components/icons";
import { prepareUpload, formatBytes, UploadRejectedError } from "@/lib/media";
import { toPersianDigits } from "@/lib/persian";
import { uploadMessengerMedia, type MessengerMessage } from "@/lib/messenger-api";
import { EmojiPicker } from "./EmojiPicker";
import { MEDIA_WARNING, formatDuration } from "./utils";

const SERVER_VIDEO_MAX = 18 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,application/zip,.docx,.xlsx,.pptx,.doc,.xls,.ppt,audio/mpeg,audio/ogg,audio/webm,audio/mp4";

export type SendPayload = {
  text?: string;
  mediaId?: string;
  replyToId?: string;
  /** برای نمایش خوش‌بینانه‌ی پیام تا پایان ارسال. */
  media?: { kind: "IMAGE" | "FILE" | "VIDEO"; mime: string; fileName: string; size: number };
};

const MAX_VOICE_SECONDS = 600;
const HOLD_MS = 600;

function pickVoiceMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* ادامه */
    }
  }
  return "";
}

export function Composer({
  conversationId,
  replyTo,
  editing,
  onCancelContext,
  onSend,
  onEditSubmit,
  onTyping,
  initialDraft,
  onDraft,
  focusSignal,
}: {
  conversationId: string;
  replyTo: MessengerMessage | null;
  editing: MessengerMessage | null;
  onCancelContext: () => void;
  onSend: (p: SendPayload) => Promise<void>;
  onEditSubmit: (m: MessengerMessage, text: string) => Promise<void>;
  onTyping: () => void;
  initialDraft?: string;
  /** هر تغییر متن (با debounce) برای ذخیره‌ی پیش‌نویس. */
  onDraft?: (text: string) => void;
  /** افزایش مقدار = فوکوس روی کادر پیام (باز شدن از اعلان «پاسخ سریع»). */
  focusSignal?: number;
}) {
  const [text, setText] = useState(initialDraft ?? editing?.text ?? "");
  const [emoji, setEmoji] = useState(false);
  const [pending, setPending] = useState<{ file: File; previewUrl: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  const [rec, setRec] = useState<{ seconds: number; locked: boolean; cancelHint: boolean } | null>(null);
  const [voiceRetry, setVoiceRetry] = useState<File | null>(null);
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; startedAt: number; mime: string; cancelled: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
  const gesture = useRef({ down: false, x: 0, cancel: false });

  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (focusSignal) areaRef.current?.focus();
  }, [focusSignal]);

  // پیش‌نویس: ذخیره با تأخیر کوتاه و یک‌بار هنگام خروج از گفتگو (با ref تا هویت تابع‌ها ضبط صدا را نشکند)
  const onDraftRef = useRef(onDraft);
  const editingRef = useRef(editing);
  useEffect(() => {
    onDraftRef.current = onDraft;
    editingRef.current = editing;
  });
  const saveDraftNow = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (!editingRef.current) onDraftRef.current?.(textRef.current);
  }, []);
  useEffect(() => {
    textRef.current = text;
    if (editing || !onDraftRef.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(saveDraftNow, 300);
  }, [text, editing, saveDraftNow]);
  useEffect(() => {
    return () => {
      saveDraftNow();
      const r = recorder.current;
      if (r) {
        r.cancelled = true;
        clearInterval(r.timer);
        try {
          r.mr.stop();
        } catch {
          r.stream.getTracks().forEach((t) => t.stop());
        }
        recorder.current = null;
      }
    };
  }, [saveDraftNow]);

  // ── پیام صوتی ──
  async function sendVoiceFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const media = await uploadMessengerMedia(conversationId, file);
      await onSend({ mediaId: media.id, replyToId: replyTo?.id, media: { kind: "FILE", mime: file.type, fileName: file.name, size: file.size } });
      setVoiceRetry(null);
    } catch (e) {
      setVoiceRetry(file);
      setError(e instanceof Error ? e.message : "ارسال پیام صوتی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  function finishRecording(send: boolean) {
    const r = recorder.current;
    if (!r) return;
    r.cancelled = !send;
    clearInterval(r.timer);
    try {
      r.mr.stop();
    } catch {
      r.stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function startRecording() {
    setError(null);
    if (recorder.current) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("مرورگر شما ضبط صدا را پشتیبانی نمی‌کند");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("دسترسی به میکروفون داده نشد؛ در تنظیمات مرورگر اجازه دهید");
      return;
    }
    const mime = pickVoiceMime();
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("ضبط صدا در این مرورگر ممکن نیست");
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setRec((x) => (x ? { ...x, seconds: sec } : x));
      if (sec >= MAX_VOICE_SECONDS) finishRecording(true);
    }, 250);
    const state = { mr, chunks, stream, startedAt, mime: mr.mimeType || mime || "audio/webm", cancelled: false, timer };
    recorder.current = state;
    mr.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      recorder.current = null;
      setRec(null);
      if (state.cancelled) return;
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      if (Date.now() - startedAt < 900) {
        setError("پیام صوتی خیلی کوتاه است");
        return;
      }
      const baseMime = state.mime.split(";")[0] || "audio/webm";
      const ext = baseMime.includes("ogg") ? "ogg" : baseMime.includes("mp4") ? "m4a" : "webm";
      const blob = new Blob(chunks, { type: baseMime });
      if (blob.size > SERVER_VIDEO_MAX) {
        setError("حجم پیام صوتی بیش از ۱۸ مگابایت است.");
        return;
      }
      void sendVoiceFile(new File([blob], `voice-${seconds}.${ext}`, { type: baseMime }));
    };
    mr.start(1000);
    setRec({ seconds: 0, locked: false, cancelHint: false });
    // اگر کاربر پیش از آماده‌شدن میکروفون انگشت را برداشته، ضبط قفل می‌شود
    if (!gesture.current.down) setRec((x) => (x ? { ...x, locked: true } : x));
  }

  function micDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (busy || rec) return;
    gesture.current = { down: true, x: e.clientX, cancel: false };
    // دکمه با شروع ضبط از DOM برداشته می‌شود؛ پس رها کردن/کشیدن را از window می‌گیریم
    const move = (ev: PointerEvent) => {
      if (!gesture.current.down || !recorder.current) return;
      const away = Math.abs(ev.clientX - gesture.current.x) > 90;
      gesture.current.cancel = away;
      setRec((x) => (x && !x.locked && x.cancelHint !== away ? { ...x, cancelHint: away } : x));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      micUp();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    void startRecording();
  }
  function micUp() {
    if (!gesture.current.down) return;
    gesture.current.down = false;
    const r = recorder.current;
    if (!r) return;
    const held = Date.now() - r.startedAt;
    if (held >= HOLD_MS) {
      // نگه‌داشتن و رها کردن: ارسال (یا لغو اگر کشیده شده)
      finishRecording(!gesture.current.cancel);
    } else {
      setRec((x) => (x ? { ...x, locked: true } : x)); // ضربه‌ی کوتاه: ضبط ادامه دارد تا ارسال/لغو
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.type.startsWith("video/") && file.size > SERVER_VIDEO_MAX) {
      setError(`حجم ویدئو زیاد است (${toPersianDigits(formatBytes(file.size))}). حداکثر ۱۸ مگابایت.`);
      return;
    }
    // هشدار ۲۴ ساعته پیش از هر ارسال تصویر/فایل/ویدئو (در همین دیالوگ تأیید)
    setPending({ file, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  }

  async function submit() {
    if (busy) return;
    const body = text.trim();
    setError(null);
    try {
      setBusy(true);
      if (editing) {
        if (!body) return;
        await onEditSubmit(editing, body);
        setText("");
        return;
      }
      if (!body) return;
      await onSend({ text: body, replyToId: replyTo?.id });
      setText("");
      onDraft?.("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارسال ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareUpload(pending.file);
      if (prepared.type.startsWith("video/") && prepared.size > SERVER_VIDEO_MAX) throw new UploadRejectedError("حجم ویدئو بیش از ۱۸ مگابایت است.");
      const media = await uploadMessengerMedia(conversationId, prepared);
      await onSend({ text: text.trim() || undefined, mediaId: media.id, replyToId: replyTo?.id, media: { kind: media.kind as "IMAGE" | "FILE" | "VIDEO", mime: prepared.type, fileName: media.fileName, size: media.size } });
      setText("");
      onDraft?.("");
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارسال فایل ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border bg-surface px-3 pt-2 pb-2">
      {(replyTo || editing) && (
        <div className="flex items-center gap-2 mb-2 rounded-xl bg-primary-soft border-s-4 border-primary px-3 py-1.5 text-[12.5px]">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-primary">{editing ? "ویرایش پیام" : `پاسخ به ${replyTo!.senderName}`}</div>
            <div className="truncate text-ink-soft" dir="auto">{(editing ?? replyTo)!.text || (replyTo?.media ? replyTo.media.fileName : "")}</div>
          </div>
          <button type="button" onClick={() => { onCancelContext(); if (editing) setText(""); }} className="text-muted text-lg cursor-pointer" aria-label="لغو">✕</button>
        </div>
      )}
      {error ? (
        <div className="mb-2 text-[12.5px] text-danger bg-danger-soft rounded-lg px-3 py-1.5 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          {voiceRetry ? (
            <>
              <button type="button" disabled={busy} onClick={() => void sendVoiceFile(voiceRetry)} className="font-bold underline cursor-pointer">تلاش دوباره</button>
              <button type="button" onClick={() => { setVoiceRetry(null); setError(null); }} className="font-bold underline cursor-pointer">حذف</button>
            </>
          ) : null}
        </div>
      ) : null}
      {rec ? (
        <div className="flex items-center gap-2 h-12">
          <button type="button" onClick={() => finishRecording(false)} className="w-10 h-10 rounded-xl text-lg hover:bg-danger-soft cursor-pointer shrink-0" aria-label="لغو ضبط" title="لغو">🗑</button>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse shrink-0" aria-hidden />
            <span className="text-[14px] font-bold tabular-nums">{formatDuration(rec.seconds)}</span>
            <span className={`text-[12px] truncate ${rec.cancelHint ? "text-danger font-bold" : "text-muted"}`}>
              {rec.locked ? "در حال ضبط… (برای ارسال ضربه بزنید)" : rec.cancelHint ? "رها کنید تا لغو شود" : "برای لغو به کنار بکشید"}
            </span>
          </div>
          {rec.locked ? (
            <button type="button" onClick={() => finishRecording(true)} className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center cursor-pointer shrink-0" aria-label="ارسال پیام صوتی">
              <SendIcon className="w-[18px] h-[18px] -scale-x-100" />
            </button>
          ) : null}
        </div>
      ) : (
      <div className="flex items-end gap-1.5 relative">
        {emoji ? (
          <div className="absolute bottom-12 start-0 z-30">
            <EmojiPicker onPick={(e) => setText((t) => t + e)} onClose={() => setEmoji(false)} />
          </div>
        ) : null}
        <button type="button" onClick={() => setEmoji((v) => !v)} className="w-10 h-10 rounded-xl text-xl hover:bg-slate-50 cursor-pointer shrink-0" aria-label="ایموجی">🙂</button>
        {!editing ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="w-10 h-10 rounded-xl text-xl hover:bg-slate-50 cursor-pointer shrink-0" aria-label="پیوست فایل" title="پیوست (فقط ۲۴ ساعت نگهداری می‌شود)">📎</button>
        ) : null}
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onPick} />
        <textarea
          ref={areaRef}
          autoFocus={!!editing}
          value={text}
          rows={1}
          maxLength={4000}
          placeholder="پیام بنویسید…"
          dir="auto"
          onChange={(e) => {
            setText(e.target.value);
            const now = Date.now();
            if (now - lastTyping.current > 2500) {
              lastTyping.current = now;
              onTyping();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") onCancelContext();
          }}
          className="flex-1 resize-none max-h-32 min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-[14px] outline-none focus:border-primary"
        />
        {!text.trim() && !editing ? (
          <button
            type="button"
            disabled={busy}
            onPointerDown={micDown}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: "none" }}
            className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 cursor-pointer shrink-0 text-lg select-none"
            aria-label="ضبط پیام صوتی"
            title="ضربه بزنید یا نگه دارید و صحبت کنید"
          >
            🎤
          </button>
        ) : (
          <button type="button" onClick={() => void submit()} disabled={busy || !text.trim()} className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 cursor-pointer shrink-0" aria-label="ارسال">
            <SendIcon className="w-[18px] h-[18px] -scale-x-100" />
          </button>
        )}
      </div>
      )}
      <div className="mt-1.5 text-[11px] text-muted flex items-center gap-1" role="note">
        <span aria-hidden>⏳</span> فایل‌ها، تصاویر و پیام‌های صوتی فقط ۲۴ ساعت نگهداری می‌شوند؛ پیش از حذف دانلود کنید.
      </div>

      {pending ? (
        <Modal title="ارسال فایل" onClose={() => !busy && setPending(null)}>
          <div className="rounded-xl bg-warning-soft border border-warning/30 text-warning px-3.5 py-3 text-[13px] font-semibold leading-relaxed mb-4">⚠ {MEDIA_WARNING}</div>
          {pending.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pending.previewUrl} alt="" className="max-h-52 rounded-xl mx-auto mb-3" />
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 mb-3">
              <span className="text-xl">{pending.file.type.startsWith("video/") ? "🎞" : "📎"}</span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold truncate" dir="auto">{pending.file.name}</div>
                <div className="text-[11.5px] text-muted">{toPersianDigits(formatBytes(pending.file.size))}</div>
              </div>
            </div>
          )}
          {error ? <div className="text-[12.5px] text-danger mb-3">{error}</div> : null}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setPending(null)} className="px-4 py-2 rounded-xl border border-border text-[13px] font-bold cursor-pointer">انصراف</button>
            <button type="button" disabled={busy} onClick={() => void confirmUpload()} className="px-4 py-2 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-60 cursor-pointer">
              {busy ? "در حال ارسال…" : "متوجه شدم، ارسال کن"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
