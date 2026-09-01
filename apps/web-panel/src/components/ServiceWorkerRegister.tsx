"use client";

import { useEffect } from "react";

/** Registers the PWA service worker once, client-side only. No UI. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support degrades gracefully to "no offline cache" — not fatal.
    });
  }, []);

  return null;
}
