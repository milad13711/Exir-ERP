"use client";

import Link from "next/link";
import clsx from "clsx";
import { toPersianDigits } from "@/lib/persian";
import { useOfflineSnapshot } from "@/lib/offline/useOffline";

const CloudIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M7 18a4 4 0 010-8 5 5 0 019.6-1.2A4.5 4.5 0 0117 18H7z" />
  </svg>
);

/** چیپ وضعیت هدر (فقط با ماژول «کار آفلاین»): آنلاین/آفلاین/در حال همگام‌سازی N/نیاز به بررسی. هیچ‌چیز برای تننت بدون ماژول نشان نمی‌دهد. */
export function OfflineIndicator() {
  const s = useOfflineSnapshot();
  if (!s.active) return null;
  const waiting = s.counts.pending + s.counts.syncing;
  const attention = s.counts.failed + s.counts.conflict;
  if (s.online && waiting === 0 && attention === 0 && !s.authRequired) return null;

  let tone = "bg-warning-soft text-warning";
  let text = "";
  if (!s.online) {
    tone = "bg-danger-soft text-danger";
    text = waiting > 0 ? `آفلاین · ${toPersianDigits(waiting)} مورد در صف` : "آفلاین";
  } else if (s.authRequired) {
    tone = "bg-danger-soft text-danger";
    text = "برای ادامه‌ی همگام‌سازی دوباره وارد شوید";
  } else if (attention > 0) {
    tone = "bg-danger-soft text-danger";
    text = `${toPersianDigits(attention)} مورد نیاز به بررسی`;
  } else {
    text = s.syncing ? `در حال همگام‌سازی (${toPersianDigits(waiting)})` : `${toPersianDigits(waiting)} مورد در صف همگام‌سازی`;
  }

  return (
    <Link
      href="/settings/offline-sync"
      className={clsx("flex items-center gap-2 py-1.5 px-3 rounded-xl min-h-[40px]", tone)}
      title="صف همگام‌سازی"
      aria-live="polite"
    >
      <CloudIcon className={clsx("w-3.5 h-3.5", s.syncing && "animate-pulse")} />
      <span className="text-[12px] font-bold whitespace-nowrap">{text}</span>
    </Link>
  );
}
