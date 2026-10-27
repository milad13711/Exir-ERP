"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { formatJalaliDateTime } from "@/lib/persian";
import type { ApiTask, TaskTick } from "@/lib/api";

export const TICK_LABEL: Record<Exclude<TaskTick, "none">, string> = { sent: "ارسال شد", delivered: "دریافت شد", seen: "دیده شد" };

/** یک تیک ✓ (SVG) — مسیر در مختصات ۱۶×۱۱. */
const CHECK = "M1.5 6.2 5 9.5 11.5 1.8";

/**
 * تیک‌های واتساپی: sent = یک تیک کم‌رنگ، delivered = یک تیک خاکستری، seen = دو تیک آبی.
 * جهت RTL تأثیری ندارد (dir=ltr روی SVG) تا تیک دوم همیشه روی اولی بیفتد.
 */
export function TickIcon({ state, className }: { state: Exclude<TaskTick, "none">; className?: string }) {
  const label = TICK_LABEL[state];
  const color = state === "seen" ? "text-sky-500" : state === "delivered" ? "text-slate-500" : "text-slate-300";
  return (
    <svg
      viewBox={state === "seen" ? "0 0 20 11" : "0 0 14 11"}
      className={clsx(state === "seen" ? "w-[18px]" : "w-[13px]", "h-[11px] shrink-0", color, className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      direction="ltr"
    >
      <title>{label}</title>
      <path d={CHECK} />
      {state === "seen" ? <path d="M6 9.5 6.6 10.1M9 9.5 15.5 1.8" /> : null}
    </svg>
  );
}

function perAssigneeState(a: { deliveredAt?: string | null; seenAt: string | null }): Exclude<TaskTick, "none"> {
  if (a.seenAt) return "seen";
  if (a.deliveredAt) return "delivered";
  return "sent";
}

/**
 * تیک وظیفه برای سازنده/مدیر (task.tick از سرور؛ برای ارجاع‌گیرنده null است ⇒ چیزی نمایش داده نمی‌شود).
 * چندنفره: با کلیک (یا فوکوس) پنجره‌ی ریز با نام، وضعیت و زمان هر نفر باز می‌شود.
 */
export function TaskTicks({ task, className }: { task: Pick<ApiTask, "tick" | "assignees" | "role">; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!task.tick || task.tick === "none") return null;
  const assignees = task.assignees ?? [];
  const multi = assignees.length > 1;
  const aggregate = <TickIcon state={task.tick} />;

  if (!multi) {
    const a = assignees[0];
    const when = a?.seenAt ?? a?.deliveredAt;
    return (
      <span className={clsx("inline-flex items-center", className)} title={when ? `${TICK_LABEL[task.tick]} · ${formatJalaliDateTime(when)}` : TICK_LABEL[task.tick]}>
        {aggregate}
      </span>
    );
  }

  const seenCount = assignees.filter((a) => a.seenAt).length;
  return (
    <span ref={ref} className={clsx("relative inline-flex items-center", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${TICK_LABEL[task.tick]} — جزئیات ${assignees.length} نفر`}
        className="inline-flex items-center gap-1 cursor-pointer rounded px-0.5"
      >
        {aggregate}
        <span className="text-[10px] text-muted">{seenCount.toLocaleString("fa-IR")}/{assignees.length.toLocaleString("fa-IR")}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="وضعیت دریافت و مشاهده به تفکیک افراد"
          onClick={(e) => e.stopPropagation()}
          className="absolute z-30 top-full mt-1 end-0 w-[min(18rem,80vw)] bg-surface border border-border rounded-xl shadow-lg p-2.5 text-[12px]"
        >
          <ul className="flex flex-col gap-1.5">
            {assignees.map((a) => {
              const s = perAssigneeState(a);
              const when = s === "seen" ? a.seenAt : s === "delivered" ? a.deliveredAt : null;
              return (
                <li key={a.userId} className="flex items-center gap-2">
                  <TickIcon state={s} />
                  <span className="font-semibold truncate flex-1">{a.name}</span>
                  <span className="text-muted text-[11px] whitespace-nowrap">{when ? `${TICK_LABEL[s]} ${formatJalaliDateTime(when)}` : TICK_LABEL[s]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
