"use client";

import { useEffect } from "react";
import { startNotificationStore, useNotificationState } from "@/lib/notification-store";
import { tabTitle } from "@/lib/notification-logic";
import { setAppBadge } from "@/lib/push-client";

/**
 * یک بار در layout: poll مشترک اعلان‌ها را روشن می‌کند، badge آیکون برنامه (PWA) را همگام می‌کند
 * و پیشوند «(۳) …» را روی عنوان تب نگه می‌دارد (حتی وقتی Next عنوان صفحه را عوض می‌کند).
 */
export function NotificationRuntime() {
  const { unreadCount, loaded } = useNotificationState();

  useEffect(() => startNotificationStore(), []);

  useEffect(() => {
    if (loaded) setAppBadge(unreadCount);
  }, [unreadCount, loaded]);

  useEffect(() => {
    if (!loaded) return;
    let applying = false;
    const apply = () => {
      if (applying) return;
      const next = tabTitle(document.title, unreadCount);
      if (next !== document.title) {
        applying = true;
        document.title = next;
        applying = false;
      }
    };
    apply();
    // Next عنوان را در ناوبری بازنویسی می‌کند؛ پیشوند را دوباره بگذار
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      document.title = tabTitle(document.title, 0);
    };
  }, [unreadCount, loaded]);

  return null;
}
