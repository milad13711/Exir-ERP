"use client";

import { useEffect, useRef, useState } from "react";
import { fetchActiveReminders, markReminderDone, snoozeReminder, type DashboardReminder } from "@/lib/api";
import { playNotificationSound } from "@/lib/notification-sound";
import { toPersianDigits } from "@/lib/persian";

const SEEN_KEY = "exir-reminder-alarms-seen";

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function writeSeen(v: Record<string, string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(v));
  } catch {
    // ذخیره‌سازی در دسترس نیست — فقط ممکن است صدا تکرار شود
  }
}

/**
 * پاپ‌آپ آلارم یادآوری: هر ۲۰ ثانیه (و روی focus) آلارم‌های سررسیده‌ی انجام‌نشده‌ی کاربر را می‌گیرد،
 * برای هر رخداد جدید صدا پخش می‌کند و تا زمان «انجام شد» یا «۱۰ دقیقه دیگر» نمایش می‌دهد.
 */
export function ReminderAlarm() {
  const [items, setItems] = useState<DashboardReminder[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const seenRef = useRef<Record<string, string>>({});

  function reload() {
    fetchActiveReminders()
      .then((list) => {
        const seen = (seenRef.current = { ...readSeen(), ...seenRef.current });
        let fresh = false;
        for (const r of list) {
          if (seen[r.id] !== r.effectiveAt) {
            seen[r.id] = r.effectiveAt;
            fresh = true;
          }
        }
        if (fresh) {
          writeSeen(seen);
          playNotificationSound();
          setHidden(new Set());
        }
        setItems(list);
      })
      .catch(() => {});
  }

  useEffect(() => {
    reload();
    const t = setInterval(reload, 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reload);
    };
  }, []);

  const visible = items.filter((r) => !hidden.has(r.id));
  if (visible.length === 0) return null;

  async function act(id: string, fn: () => Promise<unknown>) {
    setItems((cur) => cur.filter((r) => r.id !== id));
    try {
      await fn();
    } finally {
      reload();
    }
  }

  return (
    <div className="fixed top-4 inset-x-4 sm:inset-x-auto sm:start-4 sm:w-[380px] z-[70] flex flex-col gap-2" role="alert" aria-live="assertive">
      {visible.map((r) => (
        <div key={r.id} className="bg-surface border-2 border-primary rounded-2xl shadow-2xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11.5px] font-bold text-primary mb-1">
                یادآوری{r.time ? ` — ساعت ${toPersianDigits(r.time)}` : " — امروز"}
              </div>
              <div className="text-[14px] font-extrabold break-words">{r.title}</div>
              {r.note ? <div className="text-[12px] text-muted mt-1 break-words">{r.note}</div> : null}
            </div>
            <button
              type="button"
              onClick={() => setHidden((h) => new Set(h).add(r.id))}
              className="text-muted text-lg leading-none cursor-pointer shrink-0"
              aria-label="بستن"
            >
              ×
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => act(r.id, () => markReminderDone(r.id))}
              className="flex-1 py-2 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer"
            >
              انجام شد
            </button>
            <button
              type="button"
              onClick={() => act(r.id, () => snoozeReminder(r.id, 10))}
              className="flex-1 py-2 rounded-xl border border-border text-[12.5px] font-bold cursor-pointer"
            >
              ۱۰ دقیقه دیگر
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
