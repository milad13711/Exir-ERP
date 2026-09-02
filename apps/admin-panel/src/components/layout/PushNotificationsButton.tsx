"use client";

import { useEffect, useState } from "react";
import { fetchPushVapidKey, subscribePush, unsubscribePush } from "@/lib/api";

// Web Push requires the VAPID key as a raw Uint8Array, not the base64url string the server hands out.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = "unsupported" | "unavailable" | "loading" | "off" | "on" | "denied";

/** Lets a support-team member opt into push notifications for new live-chat messages, on this device. */
export function PushNotificationsButton() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    (async () => {
      const { configured } = await fetchPushVapidKey().catch(() => ({ configured: false }));
      if (!configured) {
        setState("unavailable");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  async function enable() {
    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await fetchPushVapidKey();
      if (!publicKey) {
        setState("unavailable");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await subscribePush({ endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  if (state === "unsupported" || state === "unavailable") return null;

  if (state === "denied") {
    return (
      <span className="text-[11px] text-muted hidden sm:inline" title="اعلان‌ها در تنظیمات مرورگر مسدود شده‌اند">
        اعلان مسدود
      </span>
    );
  }

  return (
    <button
      onClick={state === "on" ? disable : enable}
      disabled={state === "loading"}
      className="text-[11.5px] font-bold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 hover:bg-slate-100 text-ink-soft"
      title={state === "on" ? "اعلان‌های این دستگاه فعال است" : "برای دریافت اعلان چت زنده روی این دستگاه، فعال کنید"}
    >
      {state === "loading" ? "..." : state === "on" ? "🔔 اعلان فعال" : "🔕 فعال‌سازی اعلان‌ها"}
    </button>
  );
}
