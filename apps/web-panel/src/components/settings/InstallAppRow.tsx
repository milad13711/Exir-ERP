"use client";

import { useState } from "react";
import { useInstall } from "@/hooks/useInstall";
import { IosInstallSheet } from "@/components/pwa/IosInstallSheet";
import { promptInstall } from "@/lib/push-client";

/** نصب برنامه — Android/Chrome/Edge: دکمه‌ی بومی؛ iOS Safari: راهنمای «افزودن به صفحه‌ی اصلی»؛ سایر مرورگرها: راهنمای منوی مرورگر. */
export function InstallAppRow() {
  const install = useInstall();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!install.mounted) return null;

  const desc = install.installed
    ? "این برنامه روی این دستگاه نصب شده است"
    : install.canPrompt
      ? "دسترسی سریع‌تر مثل یک اپلیکیشن، بدون نیاز به باز کردن مرورگر"
      : install.iosManual
        ? "روی آیفون/آیپد: Share ← Add to Home Screen. اعلان فقط برای برنامه‌ی نصب‌شده کار می‌کند."
        : install.iosWrongBrowser
          ? "نصب روی آیفون فقط از Safari ممکن است؛ این صفحه را در Safari باز کنید."
          : "اگر دکمه‌ای نمی‌بینید، از منوی مرورگر «Install app / نصب برنامه» یا «Add to Home screen» را بزنید.";

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-border">
      <div>
        <div className="text-[13px] font-bold">نصب برنامه روی این دستگاه</div>
        <div className="text-[11.5px] text-muted mt-0.5 leading-5">{desc}</div>
      </div>
      {install.installed ? (
        <span className="text-[11.5px] font-bold text-success shrink-0">نصب شده ✓</span>
      ) : install.canPrompt ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await promptInstall();
            setBusy(false);
          }}
          className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
        >
          {busy ? "در حال نصب..." : "نصب برنامه"}
        </button>
      ) : install.iosManual ? (
        <button type="button" onClick={() => setSheet(true)} className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer shrink-0">
          راهنما
        </button>
      ) : null}
      <IosInstallSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}
