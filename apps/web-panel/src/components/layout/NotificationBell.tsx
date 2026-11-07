"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import Link from "next/link";
import { BellIcon, CloseIcon } from "@/components/icons";
import { NotificationList } from "@/components/notifications/NotificationList";
import { markAllRead, markRead, useNotificationState } from "@/lib/notification-store";
import { badgeLabel, filterItems, safeHref } from "@/lib/notification-logic";
import type { AppNotification } from "@/lib/api";

type Filter = "all" | "unread";

/**
 * زنگوله‌ی هدر: نشان عددی (۹۹+)، زنگ یک‌باره هنگام رسیدن اعلان جدید، و صندوق اعلان‌ها
 * (دسکتاپ: پنل کنار زنگوله؛ موبایل: برگه‌ی تمام‌صفحه). داده از store مشترک می‌آید (poll واحد، آگاه از visibility).
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const { unreadCount, importantUnread, items, loaded, arrivalTick } = useNotificationState();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // موبایل: برگه‌ی تمام‌صفحه نباید پشتش اسکرول شود
    const prev = document.body.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function handleOpen(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) void markRead(n.id);
    router.push(safeHref(n.link));
  }

  const label = badgeLabel(unreadCount);
  const shown = filterItems(items, filter);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx("relative w-10 h-10 rounded-xl border bg-white flex items-center justify-center cursor-pointer", unreadCount > 0 ? "border-danger/40 text-danger" : "border-border text-ink-soft")}
        aria-label={unreadCount > 0 ? `اعلان‌ها، ${label} مورد خوانده‌نشده` : "اعلان‌ها"}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BellIcon key={`bell-${arrivalTick}`} className={clsx("w-[19px] h-[19px]", arrivalTick > 0 && "notif-ring")} />
        {label ? (
          <span
            key={`badge-${arrivalTick}`}
            className={clsx(
              "absolute -top-1.5 -end-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-extrabold leading-none flex items-center justify-center border-2 border-white",
              arrivalTick > 0 && "notif-badge-pop",
            )}
            aria-hidden="true"
          >
            {label}
          </span>
        ) : null}
      </button>
      {/* اعلام صوتی/صفحه‌خوان برای تغییر تعداد، بدون تکرار در هر poll */}
      <span className="sr-only" role="status" aria-live="polite">
        {arrivalTick > 0 && label ? `اعلان جدید رسید؛ ${label} مورد خوانده‌نشده` : ""}
      </span>

      {open ? (
        <>
          <div className="fixed inset-0 z-10 hidden sm:block" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="اعلان‌ها"
            className="fixed inset-0 z-[70] flex flex-col bg-surface sm:absolute sm:inset-auto sm:top-full sm:mt-2 sm:end-0 sm:z-20 sm:w-[400px] sm:max-h-[560px] sm:border sm:border-border sm:rounded-xl sm:shadow-lg overflow-hidden pt-[env(safe-area-inset-top)] sm:pt-0"
          >
            <div className="shrink-0 border-b border-border bg-surface">
              <div className="flex items-center justify-between gap-2 px-4 h-14 sm:h-12">
                <span className="text-[14px] font-extrabold">
                  اعلان‌ها
                  {importantUnread > 0 ? <span className="ms-2 rounded-full bg-danger text-white text-[10.5px] font-bold px-2 py-0.5">{badgeLabel(importantUnread)} نیازمند اقدام</span> : null}
                </span>
                <button type="button" onClick={() => setOpen(false)} className="sm:hidden w-10 h-10 -me-2 flex items-center justify-center rounded-lg text-ink-soft" aria-label="بستن">
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 pb-2">
                <div className="flex gap-1" role="tablist" aria-label="فیلتر اعلان‌ها">
                  {([["all", "همه"], ["unread", `نخوانده${label ? ` (${label})` : ""}`]] as [Filter, string][]).map(([k, t]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={filter === k}
                      onClick={() => setFilter(k)}
                      className={clsx("min-h-10 sm:min-h-8 px-3 rounded-lg text-[12px] font-bold cursor-pointer", filter === k ? "bg-primary text-white" : "bg-slate-100 text-ink-soft hover:bg-slate-200")}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {unreadCount > 0 ? (
                  <button type="button" onClick={() => void markAllRead()} className="min-h-10 sm:min-h-8 px-1 text-[11.5px] font-bold text-primary cursor-pointer">
                    علامت‌گذاری همه به‌عنوان خوانده‌شده
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {!loaded ? (
                <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
              ) : (
                <NotificationList items={shown} onOpen={handleOpen} empty={filter === "unread" ? "همه‌ی اعلان‌ها را خوانده‌اید" : "اعلانی وجود ندارد"} />
              )}
            </div>

            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="shrink-0 min-h-12 flex items-center justify-center border-t border-border text-[12.5px] font-bold text-primary bg-surface pb-[env(safe-area-inset-bottom)]"
            >
              مشاهده‌ی همه‌ی اعلان‌ها
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
