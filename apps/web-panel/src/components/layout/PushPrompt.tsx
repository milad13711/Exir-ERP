"use client";

import { useEffect, useState } from "react";
import { useInstall } from "@/hooks/useInstall";
import { IosInstallSheet } from "@/components/pwa/IosInstallSheet";
import { canShowPrompt, dismissPrompt, enablePushOnThisDevice, getPushSupport, isPushOptedOut, promptInstall } from "@/lib/push-client";
import { fetchPushVapidKey } from "@/lib/api";

type Mode = "push" | "install" | "ios" | null;

/**
 * پیشنهاد نصب و فعال‌سازی اعلان — فقط با کلیک کاربر مجوز می‌خواهد (iOS/Safari بدون gesture رد می‌کند)،
 * با backoff (۳ ← ۷ ← ۱۴ ← ۳۰ روز) تا مزاحم نشود، و بسته به دستگاه: Android/دسکتاپ «نصب»، iOS راهنمای «افزودن به صفحه‌ی اصلی».
 */
export function PushPrompt() {
  const install = useInstall();
  const [pushReady, setPushReady] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    // چند ثانیه بعد از ورود تا همان لحظه‌ی اول با پنجره مزاحم نشویم
    const t = setTimeout(() => setDelayed(true), 8000);
    if (getPushSupport().state === "ready" && "Notification" in window && Notification.permission === "default" && !isPushOptedOut()) {
      fetchPushVapidKey()
        .then(({ configured }) => setPushReady(configured))
        .catch(() => {});
    }
    return () => clearTimeout(t);
  }, []);

  let mode: Mode = null;
  if (install.mounted && delayed && !hidden) {
    if (pushReady && canShowPrompt("push")) mode = "push";
    else if (install.canPrompt && !install.installed && canShowPrompt("install")) mode = "install";
    else if (install.iosManual && canShowPrompt("install")) mode = "ios";
  }
  if (!mode) return <IosInstallSheet open={sheet} onClose={() => setSheet(false)} />;

  function later() {
    dismissPrompt(mode === "push" ? "push" : "install");
    setHidden(true);
  }

  async function enable() {
    setBusy(true);
    const out = await enablePushOnThisDevice();
    setBusy(false);
    if (out.ok) setHidden(true);
    else if (out.reason === "denied") {
      dismissPrompt("push");
      setNote("اعلان مسدود شد. برای فعال‌سازی بعداً از «تنظیمات ← اعلان‌ها» دستورالعمل را ببینید.");
      setTimeout(() => setHidden(true), 5000);
    } else if (out.reason !== "dismissed") {
      setNote("فعال‌سازی انجام نشد؛ از «تنظیمات ← اعلان‌ها ← عیب‌یابی» وضعیت را بررسی کنید.");
    }
  }

  async function doInstall() {
    const r = await promptInstall();
    if (r !== "accepted") dismissPrompt("install");
    setHidden(true);
  }

  return (
    <>
      <div
        className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-5 lg:end-5 lg:start-auto lg:w-[360px] z-40 bg-surface border border-border rounded-2xl shadow-2xl p-3.5 flex flex-col gap-2.5"
        dir="rtl"
      >
        <div className="text-[13px] font-bold">
          {mode === "push" ? "اعلان پیام‌ها، یادآوری‌ها و وظایف را روی این دستگاه فعال کنید" : "اکسیر را مثل یک اپ نصب کنید"}
        </div>
        <div className="text-[12px] text-muted leading-6">
          {note ??
            (mode === "push"
              ? "حتی وقتی برنامه بسته است، پیام جدید، آلارم یادآوری و وظیفه‌ی محول‌شده را فوری ببینید."
              : mode === "ios"
                ? "روی آیفون، اعلان فقط برای برنامه‌ی افزوده‌شده به صفحه‌ی اصلی کار می‌کند."
                : "دسترسی سریع از صفحه‌ی اصلی گوشی/کامپیوتر، تمام‌صفحه و با اعلان.")}
        </div>
        <div className="flex items-center gap-2">
          {mode === "push" ? (
            <button onClick={enable} disabled={busy} className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-60">
              {busy ? "در حال فعال‌سازی..." : "فعال‌سازی اعلان"}
            </button>
          ) : mode === "install" ? (
            <button onClick={doInstall} className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer">
              نصب اپ
            </button>
          ) : (
            <button onClick={() => setSheet(true)} className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer">
              نحوه‌ی نصب
            </button>
          )}
          <button onClick={later} className="px-3 py-2 rounded-lg text-muted text-[12px] font-bold cursor-pointer">
            بعداً
          </button>
        </div>
      </div>
      <IosInstallSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}
