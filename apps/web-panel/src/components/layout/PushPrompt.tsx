"use client";

import { useEffect, useState } from "react";
import { fetchPushVapidKey, subscribePush } from "@/lib/api";

const DISMISS_KEY = "exir-push-prompt-dismissed-at";
const DISMISS_DAYS = 7;

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type InstallEvent = Event & { prompt: () => Promise<void> };

/** پیشنهاد یک‌بارِ فعال‌سازی اعلان و نصب برنامه — تا کاربر مجبور نباشد دنبال تنظیمات بگردد. */
export function PushPrompt() {
  const [canPush, setCanPush] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [isIos] = useState(
    () =>
      typeof navigator !== "undefined" &&
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !window.matchMedia("(display-mode: standalone)").matches,
  );
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86400_000;
    } catch {
      return false;
    }
  });

  useEffect(() => {

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Notification.permission === "default") {
      fetchPushVapidKey()
        .then(async ({ configured }) => {
          if (!configured) return;
          const reg = await navigator.serviceWorker.ready;
          if (!(await reg.pushManager.getSubscription())) setCanPush(true);
        })
        .catch(() => {});
    }
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setDismissed(true);
  }

  async function enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const { publicKey } = await fetchPushVapidKey();
        if (publicKey) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
          });
          const json = sub.toJSON();
          await subscribePush({ endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth });
        }
      }
    } catch {}
    setCanPush(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  if (dismissed || (!canPush && !installEvent && !isIos)) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-20 lg:bottom-5 lg:end-5 lg:start-auto lg:w-[360px] z-40 bg-surface border border-border rounded-2xl shadow-2xl p-3.5 flex flex-col gap-2.5"
      dir="rtl"
    >
      <div className="text-[13px] font-bold">اعلان‌ها را روی این دستگاه فعال کنید</div>
      <div className="text-[12px] text-muted leading-6">
        {isIos && !installEvent
          ? "برای دریافت اعلان روی آیفون: در Safari گزینه‌ی «Share» ← «Add to Home Screen» را بزنید و برنامه را از صفحه‌ی اصلی باز کنید."
          : "وظیفه‌ی جدید، تماس و تیکت‌ها را حتی وقتی برنامه بسته است، فوری ببینید."}
      </div>
      <div className="flex items-center gap-2">
        {canPush ? (
          <button onClick={enablePush} className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer">
            فعال‌سازی اعلان
          </button>
        ) : null}
        {installEvent ? (
          <button onClick={install} className="flex-1 py-2 rounded-lg bg-slate-100 text-ink-soft text-[12px] font-bold cursor-pointer">
            نصب برنامه
          </button>
        ) : null}
        <button onClick={dismiss} className="px-3 py-2 rounded-lg text-muted text-[12px] font-bold cursor-pointer">
          بعداً
        </button>
      </div>
    </div>
  );
}
