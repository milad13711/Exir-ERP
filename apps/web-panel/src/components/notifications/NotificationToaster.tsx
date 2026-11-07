"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CloseIcon } from "@/components/icons";
import { CategoryIcon } from "./NotificationList";
import { markRead, subscribeArrivals, useNotificationState, type Arrival } from "@/lib/notification-store";
import { categoryOf, CATEGORY_LABEL, isImportant, limitStack, safeHref, TOAST_AUTO_DISMISS_MS, toFa } from "@/lib/notification-logic";
import type { AppNotification } from "@/lib/api";

type Toast = { id: string; n: AppNotification; sticky: boolean; at: number };

/**
 * توست/بنر زنده‌ی اعلان جدید (در برنامه‌ی باز). مهم‌ها (ارجاع/تأیید/وظیفه/منشن) تا بستن توسط کاربر می‌مانند،
 * بقیه ۷ ثانیه؛ حداکثر ۳ توست هم‌زمان و باقی با «+N مورد دیگر». aria-live، RTL، هدف لمسی ≥۴۰px.
 */
export function NotificationToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hidden, setHidden] = useState(0);
  const toastsRef = useRef<Toast[]>([]);
  const router = useRouter();
  const { items } = useNotificationState();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const commit = useCallback((next: Toast[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.delete(id);
      commit(toastsRef.current.filter((x) => x.id !== id));
    },
    [commit],
  );

  const arm = useCallback(
    (id: string) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      timers.current.set(id, setTimeout(() => dismiss(id), TOAST_AUTO_DISMISS_MS));
    },
    [dismiss],
  );

  useEffect(
    () =>
      subscribeArrivals((arrivals: Arrival[]) => {
        const cur = toastsRef.current;
        const have = new Set(cur.map((t) => t.id));
        const added: Toast[] = arrivals.filter((a) => !have.has(a.n.id)).map((a) => ({ id: a.n.id, n: a.n, sticky: a.decision.sticky, at: Date.now() }));
        if (added.length === 0) return;
        const { visible, hidden: dropped } = limitStack([...cur, ...added], 3);
        const keep = new Set(visible.map((t) => t.id));
        for (const t of [...cur, ...added]) {
          if (!keep.has(t.id)) {
            const tm = timers.current.get(t.id);
            if (tm) clearTimeout(tm);
            timers.current.delete(t.id);
          }
        }
        for (const t of added) if (!t.sticky && keep.has(t.id)) arm(t.id);
        setHidden((h) => (cur.length === 0 ? 0 : h) + dropped);
        commit(visible);
      }),
    [arm, commit],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  // اعلانی که جای دیگر (زنگوله/دستگاه دیگر) خوانده شد، توستش هم برود (هنگام رندر مشتق می‌شود)
  const readIds = new Set(items.filter((n) => n.readAt).map((n) => n.id));
  const shown = toasts.filter((t) => !readIds.has(t.id));

  function open(t: Toast) {
    dismiss(t.id);
    void markRead(t.id);
    router.push(safeHref(t.n.link));
  }

  if (shown.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="اعلان‌های جدید"
      aria-live="polite"
      className="fixed z-[80] top-[calc(4.5rem+env(safe-area-inset-top))] inset-x-3 sm:inset-x-auto sm:end-4 sm:w-[380px] flex flex-col gap-2 pointer-events-none"
    >
      {shown.map((t) => {
        const important = isImportant(t.n);
        const cat = categoryOf(t.n);
        return (
          <div
            key={t.id}
            role={t.sticky ? "alert" : "status"}
            onMouseEnter={() => !t.sticky && timers.current.get(t.id) && clearTimeout(timers.current.get(t.id)!)}
            onMouseLeave={() => !t.sticky && arm(t.id)}
            className={clsx(
              "notif-toast-in pointer-events-auto rounded-2xl border bg-surface shadow-xl overflow-hidden border-s-4",
              important ? "border-danger/30 border-s-danger" : "border-border border-s-primary",
            )}
          >
            <div className="flex items-start gap-3 p-3.5">
              <span className={clsx("mt-0.5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white", important ? "bg-danger" : "bg-primary")} aria-hidden="true">
                <CategoryIcon category={cat} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-muted">{CATEGORY_LABEL[cat] ?? cat}</div>
                <div className="text-[13.5px] font-extrabold leading-6 text-ink">{t.n.title}</div>
                {t.n.body ? <div className="text-[12.5px] text-ink-soft leading-5 line-clamp-2 mt-0.5">{t.n.body}</div> : null}
                <div className="flex items-center gap-2 mt-2.5">
                  <button type="button" onClick={() => open(t)} className="min-h-10 px-4 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer">
                    مشاهده
                  </button>
                  {t.sticky ? <span className="text-[11px] text-muted">تا بسته‌شدن می‌ماند</span> : null}
                </div>
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="-m-1.5 w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-muted hover:bg-slate-100 cursor-pointer" aria-label="بستن اعلان">
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
      {hidden > 0 ? (
        <button type="button" onClick={() => router.push("/notifications")} className="pointer-events-auto self-center rounded-full bg-ink text-white text-[12px] font-bold px-4 min-h-10 shadow-lg cursor-pointer">
          +{toFa(hidden)} اعلان دیگر
        </button>
      ) : null}
    </div>
  );
}
