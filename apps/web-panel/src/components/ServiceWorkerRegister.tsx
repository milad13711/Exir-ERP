"use client";

import { useEffect, useState } from "react";
import { initInstallCapture, initSessionCleanup, swUrl } from "@/lib/push-client";

const CHUNK_ERR = /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/**
 * ثبت سرویس‌ورکر + اعلام «نسخه جدید».
 *  - در حالت توسعه (next dev) ثبت نمی‌شود و SW/کش‌های قبلی پاک می‌شوند (SW قدیمی JS کهنه سرو می‌کرد). برای تست پوش روی لوکال:
 *    localStorage.setItem("exir-sw-dev","1").
 *  - نسخه‌ی جدید SW (skipWaiting) یا شکست بارگذاری chunk پس از دیپلوی ⇒ نوار «نسخه جدید» با دکمه‌ی بارگذاری مجدد (خودکار رفرش نمی‌کند تا ورودی کاربر نپرد).
 */
export function ServiceWorkerRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    initInstallCapture();
    initSessionCleanup();
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const dev = process.env.NODE_ENV !== "production";
    let devOptIn = false;
    try {
      devOptIn = localStorage.getItem("exir-sw-dev") === "1";
    } catch {
      /* ok */
    }
    if (dev && !devOptIn) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister())).catch(() => {});
      if ("caches" in window) caches.keys().then((keys) => keys.filter((k) => k.startsWith("exir-")).forEach((k) => void caches.delete(k))).catch(() => {});
      return;
    }

    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (hadController) setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register(swUrl(), { scope: "/", updateViaCache: "none" })
      .then((r) => {
        reg = r;
        r.addEventListener("updatefound", () => {
          const w = r.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
      })
      .catch(() => {
        // بدون SW برنامه عادی کار می‌کند (فقط نصب/پوش/آفلاین در دسترس نیست)
      });

    const check = () => void reg?.update().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(check, 30 * 60_000);

    const onError = (e: ErrorEvent) => {
      if (CHUNK_ERR.test(e.message ?? "")) setUpdateReady(true);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? `${e.reason.name} ${e.reason.message}` : String(e.reason ?? "");
      if (CHUNK_ERR.test(msg)) setUpdateReady(true);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!updateReady) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-[420px] rounded-2xl bg-ink text-white shadow-2xl px-4 py-3 flex items-center gap-3" dir="rtl" role="status">
      <span className="text-[12.5px] font-bold flex-1">نسخه‌ی جدید برنامه آماده است</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-[12px] font-bold bg-white text-ink rounded-lg px-3 py-1.5 cursor-pointer"
      >
        بارگذاری مجدد
      </button>
      <button type="button" onClick={() => setUpdateReady(false)} className="text-white/70 text-lg leading-none cursor-pointer" aria-label="بستن">
        ×
      </button>
    </div>
  );
}
