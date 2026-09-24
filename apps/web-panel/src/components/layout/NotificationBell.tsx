"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/api";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const router = useRouter();

  function reload() {
    fetchNotifications()
      .then((data) => {
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
