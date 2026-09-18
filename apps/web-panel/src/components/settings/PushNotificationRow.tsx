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

function Toggle({ checked, onClick, disabled }: { checked: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-slate-200"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[-22px]" : "translate-x-[-2px]"
        }`}
        style={{ right: 0 }}
      />
    </button>
  );
}

/** پوش نوتیفیکیشن روی همین دستگاه/مرورگر — از هر جایی که NotificationsService.notify() صدا زده شود (وظیفه، تماس ورودی، تسویه‌ی کمیسیون و ...). */
export function PushNotificationRow() {
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
      const { configured } = await fetchPushVapidKey().catch(() => ({ configured: false, publicKey: null }));
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

  return (
    <div className="flex items-center justify-between px-4 py-4 border-b border-border">
      <div>
        <div className="text-[13px] font-bold">پوش نوتیفیکیشن روی این دستگاه</div>
        <div className="text-[11.5px] text-muted mt-0.5">
          {state === "denied"
            ? "در تنظیمات مرورگر مسدود شده — از تنظیمات سایت مرورگرتان اجازه دهید"
            : "حتی وقتی برنامه بسته است، اعلان روی این مرورگر نمایش داده می‌شود"}
        </div>
      </div>
      <Toggle checked={state === "on"} disabled={state === "loading" || state === "denied"} onClick={state === "on" ? disable : enable} />
    </div>
  );
}
