"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ChatMessage } from "@/lib/messenger-api";
import { toPersianDigits } from "@/lib/persian";
import { MediaBlock } from "./MediaBlock";
import { EmojiPicker } from "./EmojiPicker";
import { QUICK_REACTIONS, clockFa, renderText, type Ticks } from "./utils";

export type BubbleActions = {
  onReply: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onSave: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onCopy: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onPin: (m: ChatMessage, pinned: boolean) => void;
  onDelete: (m: ChatMessage, scope: "me" | "all") => void;
  onJump: (messageId: string) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
};

export function TicksMark({ ticks, onDark = true }: { ticks: Ticks; onDark?: boolean }) {
  if (ticks === "none") return null;
  const label = ticks === "seen" ? "دیده شد" : ticks === "delivered" ? "تحویل داده شد" : ticks === "pending" ? "در انتظار ارسال" : ticks === "failed" ? "ارسال نشد" : "ارسال شد";
  const tone = ticks === "failed" ? "text-red-200" : ticks === "seen" ? (onDark ? "text-sky-200" : "text-sky-500") : onDark ? "text-white/70" : "text-muted";
  return (
    <span title={label} aria-label={label} className={clsx("text-[11px] font-bold", tone)}>
      {ticks === "pending" ? "🕓" : ticks === "failed" ? "❗" : ticks === "sent" ? "✓" : "✓✓"}
    </span>
  );
}

const SWIPE_TRIGGER = 64;
const LONG_PRESS_MS = 420;

export function MessageBubble({
  m,
  mine,
  showSender,
  ticks,
  pinned,
  canDeleteForAll,
  canPin,
  myId,
  highlight,
  actions,
}: {
  m: ChatMessage;
  mine: boolean;
  showSender: boolean;
  ticks: Ticks;
  pinned: boolean;
  canDeleteForAll: boolean;
  canPin: boolean;
  myId: string;
  highlight: boolean;
  actions: BubbleActions;
}) {
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [dx, setDx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; moved: boolean; swiping: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);

  useEffect(() => {
    // انیمیشن «پرش» واکنش‌ها فقط برای تغییرهای زنده (نه بارگذاری اولیه‌ی فهرست)
    const t = setTimeout(() => setReady(true), 900);
    return () => clearTimeout(t);
  }, []);

  const local = !!m.local;
  const canInteract = !m.deleted && !local;

  function clearPress() {
    if (touch.current?.timer) clearTimeout(touch.current.timer);
  }
  function onTouchStart(e: React.TouchEvent) {
    if (!canInteract || e.touches.length !== 1) return;
    const t = e.touches[0];
    touch.current = {
      x: t.clientX,
      y: t.clientY,
      moved: false,
      swiping: false,
      timer: setTimeout(() => {
        if (touch.current && !touch.current.moved) {
          touch.current.timer = null;
          try {
            navigator.vibrate?.(12);
          } catch {
            /* بی‌اهمیت */
          }
          setMenu(true);
        }
      }, LONG_PRESS_MS),
    };
  }
  function onTouchMove(e: React.TouchEvent) {
    const st = touch.current;
    if (!st) return;
    const t = e.touches[0];
    const ddx = t.clientX - st.x;
    const ddy = t.clientY - st.y;
    if (!st.swiping && (Math.abs(ddy) > 14 || Math.abs(ddx) > 10)) {
      st.moved = true;
      clearPress();
      if (Math.abs(ddx) > Math.abs(ddy) * 1.5) st.swiping = true;
    }
    if (st.swiping) setDx(Math.max(-90, Math.min(90, ddx)));
  }
  function onTouchEnd() {
    const st = touch.current;
    clearPress();
    touch.current = null;
    if (st?.swiping && Math.abs(dx) >= SWIPE_TRIGGER) actions.onReply(m);
    setDx(0);
  }

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) {
        setMenu(false);
        setMore(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [menu]);

  if (m.kind === "SYSTEM") {
    return (
      <div id={`msg-${m.id}`} className="flex justify-center my-1.5">
        <span className="text-[11.5px] text-muted bg-slate-100 rounded-full px-3 py-1">{m.text}</span>
      </div>
    );
  }

  const act = (fn: () => void) => () => {
    setMenu(false);
    setMore(false);
    fn();
  };

  return (
    <div id={`msg-${m.id}`} className={clsx("flex my-0.5 group", mine ? "justify-start" : "justify-end")} ref={ref}>
      {/* RTL: «من» سمت راست (ابتدا)، دیگران چپ؛ justify-start در RTL یعنی راست */}
      <div className="relative max-w-[82%] md:max-w-[68%]">
        {dx !== 0 ? <span className="absolute top-1/2 -translate-y-1/2 text-lg text-primary" style={{ [dx < 0 ? "left" : "right"]: -34 }} aria-hidden>↩</span> : null}
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            if (canInteract) setMenu(true);
          }}
          onDoubleClick={() => canInteract && actions.onReact(m, "👍")}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          style={{ touchAction: "pan-y", transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform 0.18s ease-out", WebkitTouchCallout: "none" }}
          className={clsx(
            "rounded-2xl px-3 py-2 text-[14px] leading-relaxed shadow-sm select-none md:select-text",
            local && m.local === "pending" && "opacity-80",
            mine ? "bg-primary text-white rounded-te-md" : "bg-surface border border-border rounded-ts-md",
            highlight && "ring-2 ring-warning",
          )}
        >
          {showSender && !mine ? <div className="text-[12px] font-extrabold text-primary mb-0.5">{m.senderName}</div> : null}
          {m.deleted ? (
            <div className={clsx("italic text-[13px]", mine ? "text-white/80" : "text-muted")}>🚫 این پیام حذف شد</div>
          ) : (
            <>
              {m.forwardedFrom ? <div className={clsx("text-[11.5px] font-bold mb-1", mine ? "text-white/80" : "text-accent")}>↪ فوروارد از {m.forwardedFrom}</div> : null}
              {m.replyTo ? (
                <button
                  type="button"
                  onClick={() => actions.onJump(m.replyTo!.id)}
                  className={clsx("block w-full text-start rounded-lg border-s-4 px-2 py-1 mb-1 text-[12px] cursor-pointer", mine ? "bg-white/15 border-white/60" : "bg-primary-soft border-primary")}
                >
                  <div className="font-bold">{m.replyTo.senderName}</div>
                  <div className="truncate opacity-80" dir="auto">{m.replyTo.deleted ? "پیام حذف شده" : m.replyTo.text || (m.replyTo.hasMedia ? "فایل" : "")}</div>
                </button>
              ) : null}
              {m.media ? <MediaBlock media={m.media} mine={mine} /> : null}
              {m.text ? (
                <div className="whitespace-pre-wrap break-words" dir="auto">
                  {renderText(m.text)}
                </div>
              ) : null}
            </>
          )}
          <div className={clsx("flex items-center gap-1.5 justify-end mt-0.5 text-[10.5px]", mine ? "text-white/75" : "text-muted")}>
            {pinned ? <span title="سنجاق‌شده">📌</span> : null}
            {m.editedAt && !m.deleted ? <span>ویرایش‌شده</span> : null}
            <span>{clockFa(m.createdAt)}</span>
            <TicksMark ticks={ticks} />
          </div>
        </div>

        {m.reactions.length > 0 ? (
          <div className={clsx("flex flex-wrap gap-1 mt-1", mine ? "justify-start" : "justify-end")}>
            {m.reactions.map((r) => {
              const iReacted = r.userIds.includes(myId);
              return (
                <button
                  key={`${r.emoji}-${r.userIds.length}`}
                  type="button"
                  onClick={() => actions.onReact(m, r.emoji)}
                  className={clsx("text-[12px] rounded-full px-2 py-0.5 border cursor-pointer", ready && "msgr-pop", iReacted ? "bg-primary-soft border-primary text-primary font-bold" : "bg-surface border-border")}
                >
                  {r.emoji} {toPersianDigits(r.userIds.length)}
                </button>
              );
            })}
          </div>
        ) : null}

        {local && m.local === "failed" ? (
          <div className="flex items-center gap-2 mt-0.5 text-[11.5px] text-danger" role="alert">
            <span>ارسال نشد{m.localError ? `: ${m.localError}` : ""}</span>
            <button type="button" onClick={() => actions.onRetry(m)} className="font-bold underline cursor-pointer">تلاش دوباره</button>
            <button type="button" onClick={() => actions.onDiscard(m)} className="font-bold underline cursor-pointer">حذف</button>
          </div>
        ) : null}

        {canInteract ? (
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-label="گزینه‌های پیام"
            className={clsx("absolute top-1 w-7 h-7 rounded-full bg-surface border border-border shadow text-muted text-sm items-center justify-center cursor-pointer", mine ? "-end-9" : "-start-9", "hidden group-hover:flex focus:flex", menu && "!flex")}
          >
            ⋯
          </button>
        ) : m.deleted ? (
          <button
            type="button"
            onClick={() => actions.onDelete(m, "me")}
            className="text-[11px] text-muted underline mt-0.5 cursor-pointer"
          >
            حذف از نمای من
          </button>
        ) : null}

        {menu && canInteract ? (
          <div className={clsx("absolute z-30 top-8 w-[210px] bg-surface border border-border rounded-2xl shadow-xl p-1.5 text-[13px]", mine ? "start-0" : "end-0")}>
            <div className="flex items-center gap-1 px-1 pb-1.5 border-b border-border mb-1">
              {QUICK_REACTIONS.slice(0, 2).map((e) => (
                <button key={e} type="button" onClick={act(() => actions.onReact(m, e))} className="w-8 h-8 text-lg rounded-lg hover:bg-primary-soft cursor-pointer">{e}</button>
              ))}
              <button type="button" onClick={() => setMore((v) => !v)} className="w-8 h-8 rounded-lg hover:bg-primary-soft cursor-pointer text-muted" aria-label="ایموجی‌های بیشتر">＋</button>
            </div>
            {more ? (
              <div className="absolute z-40 top-full mt-1 end-0">
                <EmojiPicker onPick={(e) => act(() => actions.onReact(m, e))()} onClose={() => setMore(false)} />
              </div>
            ) : null}
            <MenuItem onClick={act(() => actions.onReply(m))}>↩ پاسخ</MenuItem>
            <MenuItem onClick={act(() => actions.onForward(m))}>↪ فوروارد</MenuItem>
            <MenuItem onClick={act(() => actions.onSave(m))}>🔖 ذخیره</MenuItem>
            {m.text ? <MenuItem onClick={act(() => actions.onCopy(m))}>⧉ کپی متن</MenuItem> : null}
            {mine && m.kind === "TEXT" && !m.forwardedFrom ? <MenuItem onClick={act(() => actions.onEdit(m))}>✎ ویرایش</MenuItem> : null}
            {canPin ? <MenuItem onClick={act(() => actions.onPin(m, !pinned))}>📌 {pinned ? "برداشتن سنجاق" : "سنجاق"}</MenuItem> : null}
            <MenuItem danger onClick={act(() => actions.onDelete(m, "me"))}>🗑 حذف برای من</MenuItem>
            {canDeleteForAll ? <MenuItem danger onClick={act(() => actions.onDelete(m, "all"))}>🗑 حذف برای همه</MenuItem> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={clsx("w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer", danger && "text-danger")}>
      {children}
    </button>
  );
}
