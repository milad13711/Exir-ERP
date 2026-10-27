"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSafeInternalPath, syncPushOnThisDevice } from "@/lib/push-client";

/**
 * بی‌صدا و بدون UI؛ فقط در محیط واردشده (داخل AppShell) سوار می‌شود:
 *  - پس از ورود/بازگشت به برنامه: اشتراک همین دستگاه (اگر اجازه از قبل هست) روی سرور تازه می‌شود.
 *  - پیام‌های سرویس‌ورکر: ناوبری از کلیک اعلان، چرخش اشتراک، و «push-received» برای تازه‌سازی فوری زنگوله.
 */
export function PushSync() {
  const router = useRouter();

  useEffect(() => {
    void syncPushOnThisDevice();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncPushOnThisDevice();
    };
    document.addEventListener("visibilitychange", onVisible);

    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: unknown } | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "sw-navigate" && isSafeInternalPath(d.url)) router.push(d.url);
      else if (d.type === "push-resubscribed") void syncPushOnThisDevice({ force: true });
      else if (d.type === "push-received") window.dispatchEvent(new CustomEvent("exir:push-received", { detail: d }));
      else if (d.type === "reminder-action") window.dispatchEvent(new CustomEvent("exir:reminder-action", { detail: d }));
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [router]);

  return null;
}
