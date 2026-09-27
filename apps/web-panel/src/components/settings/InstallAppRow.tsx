"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type State = "unsupported" | "installed" | "available" | "prompting" | "dismissed";

/**
 * نصب برنامه روی گوشی/دسکتاپ — با API استاندارد beforeinstallprompt (نه یک هیوریستیک سفارشی)
 * تا روی همه‌ی گوشی‌های اندروید/کروم به‌صورت یکسان کار کند. برای مرورگرهایی که این رویداد را
 * پشتیبانی نمی‌کنند (مثل iOS Safari) دکمه‌ای مرده نشان داده نمی‌شود — کل ردیف مخفی می‌ماند.
 */
export function InstallAppRow() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<State>("unsupported");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) {
      setState("installed");
      return;
    }
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
      setState("available");
    };
    const onAppInstalled = () => {
      setState("installed");
      setDeferredEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferredEvent) return;
    setState("prompting");
    try {
      await deferredEvent.prompt();
      const choice = await deferredEvent.userChoice;
      setState(choice.outcome === "accepted" ? "installed" : "dismissed");
    } catch {
      setState("dismissed");
    } finally {
      setDeferredEvent(null);
    }
  }

  // مرورگر این استاندارد را پشتیبانی نمی‌کند (مثلاً iOS Safari) — به‌جای دکمه‌ی مرده، کل ردیف مخفی می‌شود
  if (state === "unsupported") return null;

  return (
    <div className="flex items-center justify-between px-4 py-4 border-b border-border">
      <div>
        <div className="text-[13px] font-bold">نصب برنامه روی این دستگاه</div>
        <div className="text-[11.5px] text-muted mt-0.5">
          {state === "installed" ? "این برنامه از قبل روی این دستگاه نصب شده است" : "دسترسی سریع‌تر مثل یک اپلیکیشن، بدون نیاز به باز کردن مرورگر"}
        </div>
      </div>
      {state === "installed" ? (
        <span className="text-[11.5px] font-bold text-success shrink-0">نصب شده ✓</span>
      ) : (
        <button
          type="button"
          onClick={handleInstall}
          disabled={state !== "available"}
          className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
        >
          {state === "prompting" ? "در حال نصب..." : "نصب برنامه"}
        </button>
      )}
    </div>
  );
}
