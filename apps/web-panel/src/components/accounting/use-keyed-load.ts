import { useEffect, useState } from "react";

/**
 * بارگذاری ناهمگام با کلید: هر تغییر `key` درخواست جدید می‌زند، پاسخ قدیمی نادیده گرفته می‌شود و
 * `loading` از روی «پاسخ مربوط به کلید فعلی نرسیده» مشتق می‌شود (بدون setState هم‌زمان در effect).
 */
export function useKeyedLoad<T>(key: string, load: () => Promise<T>): { data: T | null; error: string | null; loading: boolean } {
  const [res, setRes] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setRes({ key, data, error: null }))
      .catch((e) => alive && setRes({ key, data: null, error: e instanceof Error ? e.message : "بارگذاری ناموفق بود" }));
    return () => {
      alive = false;
    };
    // load عمداً در وابستگی‌ها نیست: هویت درخواست فقط با key تعیین می‌شود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = res?.key === key ? res : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: current === null };
}
