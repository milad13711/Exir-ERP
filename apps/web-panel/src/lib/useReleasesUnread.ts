"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchReleasesUnread } from "@/lib/module-releases-api";

/** تعداد تازه‌های سیستم که کاربر هنوز ندیده؛ هر ۲ دقیقه و روی فوکوس/رویداد «exir:releases-read» تازه می‌شود. */
export function useReleasesUnread(): number {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    fetchReleasesUnread()
      .then((r) => setN(r.unreadCount))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    window.addEventListener("focus", load);
    window.addEventListener("exir:releases-read", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", load);
      window.removeEventListener("exir:releases-read", load);
    };
  }, [load]);
  return n;
}
