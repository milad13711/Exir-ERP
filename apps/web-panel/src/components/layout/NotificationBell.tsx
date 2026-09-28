"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  fetchNotificationPreferences,
  type AppNotification,
} from "@/lib/api";
import { playNotificationSound } from "@/lib/notification-sound";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const router = useRouter();
  // این اعلان‌ها فقط با poll (هر ۱۵ ثانیه + روی focus/visibility) دریافت می‌شوند، نه سوکت زنده؛
  // پس «صدا هنگام رسیدن» یعنی صدا وقتی یک poll نسبت به poll قبلی تعداد نخوانده‌ی بیشتری برگرداند.
  const prevUnreadRef = useRef<number | null>(null);
  const soundEnabledRef = useRef(true);

  function reload() {
    // pref هم اینجا (با همان تناوب) تازه می‌شود تا تغییر کلید در صفحه‌ی تنظیمات — بدون رفرش کامل —
    // ظرف چند ثانیه روی همین نمونه‌ی نصب‌شده در layout هم اثر بگذارد.
    fetchNotificationPreferences()
      .then((prefs) => {
        soundEnabledRef.current = prefs.soundEnabled;
      })
      .catch(() => {});
    fetchNotifications()
      .then((data) => {
        if (prevUnreadRef.current !== null && data.unreadCount > prevUnreadRef.current && soundEnabledRef.current) {
          playNotificationSound();
        }
        prevUnreadRef.current = data.unreadCount;
        setUnreadCount(data.unreadCount);
        setItems(data.items);
      })
      .catch(() => {});
  }

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reload);
    };
  }, []);

  async function handleClick(n: AppNotification) {
    if (!n.readAt) {
      await markNotificationRead(n.id);
      reload();
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    reload();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-10 h-10 rounded-xl border border-border bg-white flex items-center justify-center text-ink-soft cursor-pointer"
        aria-label="اعلان‌ها"
      >
        <BellIcon className="w-[19px] h-[19px]" />
        {unreadCount > 0 ? (
          <span className="absolute top-2 start-2.5 w-2 h-2 rounded-full bg-danger border-2 border-white" />
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 end-0 w-[320px] max-h-[420px] overflow-y-auto bg-surface border border-border rounded-xl shadow-lg z-20">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface">
              <span className="text-[13px] font-bold">اعلان‌ها</span>
              {unreadCount > 0 ? (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[11.5px] font-bold text-primary cursor-pointer"
                >
                  علامت‌گذاری همه به‌عنوان خوانده‌شده
                </button>
              ) : null}
            </div>
            {items === null ? (
              <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-muted text-sm">اعلانی وجود ندارد</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-right px-4 py-3 border-b border-border last:border-b-0 hover:bg-slate-50 cursor-pointer ${
                    !n.readAt ? "bg-primary-soft/40" : ""
                  }`}
                >
                  <div className="text-[12.5px] font-bold">{n.title}</div>
                  {n.body ? <div className="text-[11.5px] text-muted mt-0.5">{n.body}</div> : null}
                  <div className="text-[10.5px] text-muted mt-1">{formatJalaliDateTime(n.createdAt)}</div>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
