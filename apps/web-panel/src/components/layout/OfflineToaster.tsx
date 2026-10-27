"use client";

import { useEffect, useState } from "react";
import { toPersianDigits } from "@/lib/persian";
import type { RunSummary } from "@/lib/offline/types";

/** اعلان‌های کوتاه پایین صفحه: «در صف همگام‌سازی ذخیره شد» و خلاصه‌ی پس از همگام‌سازی. */
export function OfflineToaster() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const show = (m: string) => {
      setMsg(m);
      if (t) clearTimeout(t);
      t = setTimeout(() => setMsg(null), 5000);
    };
    const onQueued = (e: Event) => {
      const d = (e as CustomEvent<{ label: string; note: string | null }>).detail;
      show(`ذخیره شد — در صف همگام‌سازی${d?.note ? ` (${d.note})` : ""}`);
    };
    const onSummary = (e: Event) => {
      const s = (e as CustomEvent<RunSummary>).detail;
      const parts: string[] = [];
      if (s.synced > 0) parts.push(`${toPersianDigits(s.synced)} مورد همگام شد`);
      const review = s.failed + s.conflicts;
      if (review > 0) parts.push(`${toPersianDigits(review)} مورد نیاز به بررسی`);
      if (parts.length) show(parts.join("، "));
    };
    window.addEventListener("exir:offline-queued", onQueued);
    window.addEventListener("exir:offline-summary", onSummary);
    return () => {
      window.removeEventListener("exir:offline-queued", onQueued);
      window.removeEventListener("exir:offline-summary", onSummary);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!msg) return null;
  return (
    <div role="status" className="fixed bottom-20 lg:bottom-6 inset-x-4 z-[60] flex justify-center pointer-events-none">
      <div className="bg-ink text-white text-[13px] font-semibold rounded-xl px-4 py-3 shadow-lg max-w-[420px]">{msg}</div>
    </div>
  );
}
