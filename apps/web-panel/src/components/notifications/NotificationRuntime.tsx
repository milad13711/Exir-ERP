"use client";

import { useEffect } from "react";
import { startNotificationStore, useNotificationState } from "@/lib/notification-store";
import { setTabTitleCount } from "@/lib/tab-title";

/**
 * یک بار در layout: poll مشترک اعلان‌ها را روشن می‌کند و تعداد نخوانده‌ها را به مالک واحد عنوان تب/نشان برنامه
 * (lib/tab-title.ts) می‌دهد. این‌جا عمداً ناظر جدایی روی <title> نیست: دو ناظر (این + پیام‌رسان) با اعداد متفاوت
 * همدیگر را بی‌پایان بیدار می‌کردند و مرورگر قفل می‌شد.
 */
export function NotificationRuntime() {
  const { unreadCount, loaded } = useNotificationState();

  useEffect(() => startNotificationStore(), []);

  useEffect(() => {
    if (loaded) setTabTitleCount("notifications", unreadCount);
  }, [unreadCount, loaded]);

  useEffect(() => () => setTabTitleCount("notifications", 0), []);

  return null;
}
