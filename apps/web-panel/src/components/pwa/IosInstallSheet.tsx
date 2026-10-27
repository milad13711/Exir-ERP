"use client";

import { getPlatform, iosInstallSteps } from "@/lib/push-client";
import { toPersianDigits } from "@/lib/persian";

/** راهنمای نصب روی iOS: پوش فقط برای برنامه‌ی افزوده‌شده به صفحه‌ی اصلی کار می‌کند (iOS ۱۶٫۴+). */
export function IosInstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const steps = iosInstallSteps(getPlatform().browser);
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" dir="rtl" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-[420px] bg-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="text-[14px] font-extrabold mb-1">افزودن به صفحه‌ی اصلی (آیفون / آیپد)</div>
        <p className="text-[12px] text-muted leading-6 mb-3">
          فقط به این روش برنامه نصب می‌شود و می‌توانید اعلان دریافت کنید (iOS نسخه‌ی ۱۶٫۴ یا بالاتر).
        </p>
        <ol className="flex flex-col gap-2.5 mb-4">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px] leading-6">
              <span className="w-6 h-6 shrink-0 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-[12px]">{toPersianDigits(i + 1)}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <button type="button" onClick={onClose} className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer">
          متوجه شدم
        </button>
      </div>
    </div>
  );
}
