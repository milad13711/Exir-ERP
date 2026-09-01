"use client";

import clsx from "clsx";
import { useConnectivity } from "@/lib/offline/useConnectivity";
import { toPersianDigits } from "@/lib/persian";

const WifiOffIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 3l18 18" />
    <path d="M8.5 16.5a5 5 0 017 0" />
    <path d="M5 12.5a11 11 0 013-2.1M19 12.5a11 11 0 00-4.5-3.2" />
    <path d="M12 20h.01" />
  </svg>
);

/** Header pill shown only when there's something to say: offline, or writes still waiting to sync. */
export function OfflineIndicator() {
  const { online, pendingCount } = useConnectivity();

  if (online && pendingCount === 0) return null;

  return (
    <div
      className={clsx(
        "hidden sm:flex items-center gap-2 py-1.5 px-3.5 rounded-xl",
        online ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger",
      )}
      title={online ? "در حال ارسال تغییرات ذخیره‌شده" : "اتصال اینترنت قطع است"}
    >
      <WifiOffIcon className="w-3.5 h-3.5" />
      <span className="text-[12px] font-bold">
        {online
          ? `در حال همگام‌سازی (${toPersianDigits(pendingCount)})`
          : pendingCount > 0
            ? `آفلاین · ${toPersianDigits(pendingCount)} مورد در صف`
            : "آفلاین"}
      </span>
    </div>
  );
}
