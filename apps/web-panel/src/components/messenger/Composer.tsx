"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SendIcon } from "@/components/icons";
import { prepareUpload, formatBytes, UploadRejectedError } from "@/lib/media";
import { toPersianDigits } from "@/lib/persian";
import { uploadMessengerMedia, type MessengerMessage } from "@/lib/messenger-api";
import { EmojiPicker } from "./EmojiPicker";
import { MEDIA_WARNING } from "./utils";

const SERVER_VIDEO_MAX = 18 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,application/zip,.docx,.xlsx,.pptx,.doc,.xls,.ppt,audio/mpeg,audio/ogg";

export type SendPayload = { text?: string; mediaId?: string; replyToId?: string };

export function Composer({
  conversationId,
  replyTo,
  editing,
  onCancelContext,
  onSend,
  onEditSubmit,
  onTyping,
  initialDraft,
}: {
  conversationId: string;
  replyTo: MessengerMessage | null;
  editing: MessengerMessage | null;
  onCancelContext: () => void;
  onSend: (p: SendPayload) => Promise<void>;
  onEditSubmit: (m: MessengerMessage, text: string) => Promise<void>;
  onTyping: () => void;
  initialDraft?: string;
}) {
  const [text, setText] = useState(initialDraft ?? editing?.text ?? "");
  const [emoji, setEmoji] = useState(false);
  const [pending, setPending] = useState<{ file: File; previewUrl: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    return () => {
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

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
      await onSend({ text: text.trim() || undefined, mediaId: media.id, replyToId: replyTo?.id });
      setText("");
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
      {error ? <div className="mb-2 text-[12.5px] text-danger bg-danger-soft rounded-lg px-3 py-1.5">{error}</div> : null}
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
        <button type="button" onClick={() => void submit()} disabled={busy || !text.trim()} className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 cursor-pointer shrink-0" aria-label="ارسال">
          <SendIcon className="w-[18px] h-[18px] -scale-x-100" />
        </button>
      </div>
      <div className="mt-1.5 text-[11px] text-muted flex items-center gap-1" role="note">
        <span aria-hidden>⏳</span> فایل‌ها و تصاویر فقط ۲۴ ساعت نگهداری می‌شوند؛ پیش از حذف دانلود کنید.
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
