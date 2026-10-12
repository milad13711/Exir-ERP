"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  dismissToast,
  getServerToastsSnapshot,
  getToastsSnapshot,
  openConversationFromAnywhere,
  quickReply,
  registerRouterNavigate,
  startMessengerRuntime,
  stopMessengerRuntime,
  subscribeToasts,
  type MessengerToast,
} from "@/lib/messenger-runtime";
import { Avatar } from "./utils";

const AUTO_DISMISS_MS = 7000;

/** سوار روی کل برنامه (AppShell): اتصال زنده + اعلان‌های بالای صفحه. فقط وقتی ماژول پیام‌رسان نصب است سوار می‌شود. */
export function MessengerRuntime() {
  const router = useRouter();
  const toasts = useSyncExternalStore(subscribeToasts, getToastsSnapshot, getServerToastsSnapshot);

  useEffect(() => {
    registerRouterNavigate((url) => router.push(url));
    startMessengerRuntime();
    return () => {
      registerRouterNavigate(null);
      stopMessengerRuntime();
    };
  }, [router]);

  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pointer-events-none"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.conversationId} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: MessengerToast }) {
  const [paused, setPaused] = useState(false);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // هر پیام تازه در همان گفتگو، تایمر را از نو می‌شمارد
  useEffect(() => {
    if (paused || replying) return;
    const t = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [paused, replying, toast.id, toast.at]);

  useEffect(() => {
    if (replying) inputRef.current?.focus();
  }, [replying]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await quickReply(toast.conversationId, body, toast.seq);
      dismissToast(toast.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارسال ناموفق بود");
      setBusy(false);
    }
  }

  function open() {
    dismissToast(toast.id);
    openConversationFromAnywhere(toast.conversationId, false);
  }

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="msgr-toast-in pointer-events-auto w-[min(94vw,430px)] rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden"
    >
      <div className="flex items-start gap-2.5 p-3">
        <button type="button" onClick={open} className="flex items-start gap-2.5 min-w-0 flex-1 text-start cursor-pointer" aria-label={`باز کردن گفتگو با ${toast.title}`}>
          <Avatar name={toast.title} size={38} />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-extrabold truncate">{toast.title}</div>
            <div className="text-[12.5px] text-ink-soft line-clamp-2 break-words" dir="auto">
              {toast.sender ? <b>{toast.sender}: </b> : null}
              {toast.preview}
            </div>
          </div>
        </button>
        <button type="button" onClick={() => setReplying((v) => !v)} className="text-[12px] font-bold text-primary px-2 py-1 rounded-lg hover:bg-primary-soft cursor-pointer shrink-0">
          پاسخ
        </button>
        <button type="button" onClick={() => dismissToast(toast.id)} className="w-7 h-7 rounded-lg text-muted hover:bg-slate-50 cursor-pointer shrink-0" aria-label="بستن">
          ✕
        </button>
      </div>
      {replying ? (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              dir="auto"
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === "Escape") setReplying(false);
              }}
              placeholder="پاسخ سریع…"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-[13px] outline-none focus:border-primary"
            />
            <button type="button" onClick={() => void send()} disabled={busy || !text.trim()} className="px-3 py-1.5 rounded-xl bg-primary text-white text-[12.5px] font-bold disabled:opacity-40 cursor-pointer">
              {busy ? "…" : "ارسال"}
            </button>
          </div>
          {error ? <div className="text-[11.5px] text-danger mt-1">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
