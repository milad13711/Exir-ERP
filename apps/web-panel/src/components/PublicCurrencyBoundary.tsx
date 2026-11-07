"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fetchPublicCurrency } from "@/lib/api";
import { setMoneyUnit } from "@/lib/persian";

/**
 * صفحه‌های عمومی (فروشگاه، رویداد، فاکتور، رزرو، ...) بدون ورود کاربر باز می‌شوند، پس واحد پول تننت
 * (تومان یا ریال) را از endpoint عمومی می‌گیرند و پیش از رندر محتوا در formatMoney می‌گذارند.
 * اگر درخواست شکست خورد، پیش‌فرض «تومان» می‌ماند و صفحه معطل نمی‌شود.
 */
export function PublicCurrencyBoundary({ slug, children }: { slug: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPublicCurrency(slug)
      .then((c) => setMoneyUnit(c?.label))
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (!ready) return null;
  return <>{children}</>;
}
