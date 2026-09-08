"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CheckIcon, CloseIcon, BoltIcon } from "@/components/icons";
import { fetchOnboardingStatus, dismissOnboarding, type OnboardingMission } from "@/lib/api";

const POLL_MS = 20_000;
const CELEBRATION_MS = 3200;

/**
 * چک‌لیست شروع کار — یک ماموریت به‌ازای هر ماژول نصب‌شده‌ی تننت («اولین
 * مخاطب را ثبت کنید» و مشابه)، با تشخیص تکمیل از روی داده‌ی واقعی (نه یک
 * فلگ دستی) تا هیچ‌وقت با واقعیت داده ناهماهنگ نشود. کاملاً قابل بستن —
 * وضعیت dismissed سمت سرور (ModuleSetting) نگه داشته می‌شود تا در همه‌ی
 * دستگاه‌ها یک‌بار بسته شدنش کافی باشد.
 */
export function OnboardingGuide() {
  const [missions, setMissions] = useState<OnboardingMission[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const prevCompletedRef = useRef<Set<string>>(new Set());

  function reload() {
    fetchOnboardingStatus()
      .then((res) => {
        if (res.dismissed) {
          setDismissed(true);
          return;
        }
        const nowCompleted = new Set(res.missions.filter((m) => m.completed).map((m) => m.code));
        const newlyDone = res.missions.find((m) => m.completed && !prevCompletedRef.current.has(m.code));
        if (newlyDone && prevCompletedRef.current.size > 0) {
          setCelebrating(newlyDone.title);
          setTimeout(() => setCelebrating(null), CELEBRATION_MS);
        }
        prevCompletedRef.current = nowCompleted;
        setMissions(res.missions);
      })
      .catch(() => {});
  }

  useEffect(() => {
    reload();
    const interval = setInterval(reload, POLL_MS);
    function onFocus() {
      reload();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function handleDismiss() {
    setDismissed(true);
    try {
      await dismissOnboarding();
    } catch {
      // بستن محلی همین الان اتفاق افتاد؛ اگر درخواست سرور شکست بخورد، دفعه‌ی
      // بعد که صفحه لود شود دوباره نمایش داده می‌شود — قابل قبول، نه بحرانی.
    }
  }

  if (dismissed || !missions || missions.length === 0) return null;

  const completedCount = missions.filter((m) => m.completed).length;
  const allDone = completedCount === missions.length;
  const nextMission = missions.find((m) => !m.completed);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed z-40 bottom-6 start-6 flex items-center gap-2 bg-primary text-white rounded-full py-2.5 ps-4 pe-3.5 shadow-xl cursor-pointer"
      >
        <BoltIcon className="w-4 h-4" />
        <span className="text-[12.5px] font-bold">
          شروع سریع ({completedCount}/{missions.length})
        </span>
      </button>
    );
  }

  return (
    <div className="fixed z-40 bottom-4 start-4 sm:bottom-6 sm:start-6 w-[calc(100%-2rem)] sm:w-[320px] bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
      <div className="bg-gradient-to-l from-primary to-primary-dark px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <BoltIcon className="w-4.5 h-4.5" />
          <span className="text-[13px] font-extrabold">شروع سریع اکسیر</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(true)}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/80 hover:bg-white/15 cursor-pointer"
            aria-label="کوچک کردن"
          >
            <span className="text-lg leading-none mb-1">−</span>
          </button>
          <button
            onClick={handleDismiss}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/80 hover:bg-white/15 cursor-pointer"
            aria-label="بستن راهنما"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between text-[11px] font-semibold text-muted mb-1.5">
          <span>پیشرفت شما</span>
          <span>
            {completedCount} از {missions.length}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all duration-500"
            style={{ width: `${(completedCount / missions.length) * 100}%` }}
          />
        </div>
      </div>

      {celebrating ? (
        <div className="mx-4 mt-3 bg-success-soft text-success text-[12px] font-bold rounded-xl px-3 py-2.5 text-center">
          🎉 آفرین! «{celebrating}» تکمیل شد
        </div>
      ) : null}

      {allDone ? (
        <div className="px-4 py-6 text-center">
          <div className="text-[28px] mb-1.5">🎉</div>
          <div className="text-[13px] font-extrabold mb-1">همه‌ی مأموریت‌ها تکمیل شد!</div>
          <div className="text-[11.5px] text-muted leading-relaxed mb-3.5">
            عالی بود — حالا کاملاً با اکسیر آشنا شدید.
          </div>
          <button
            onClick={handleDismiss}
            className="text-[12px] font-bold text-white bg-primary px-4 py-2 rounded-lg cursor-pointer"
          >
            متوجه شدم
          </button>
        </div>
      ) : (
        <div className="max-h-[280px] overflow-y-auto px-2 py-2 flex flex-col gap-1">
          {missions.map((m) => {
            const isNext = !m.completed && m.code === nextMission?.code;
            return (
              <div
                key={m.code}
                className={clsx(
                  "flex items-start gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors",
                  isNext ? "bg-primary-soft" : "",
                )}
              >
                <span
                  className={clsx(
                    "w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    m.completed ? "bg-success text-white" : "border-2 border-border",
                  )}
                >
                  {m.completed ? <CheckIcon className="w-3 h-3" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={clsx("text-[12px] font-bold", m.completed ? "text-muted line-through" : "text-ink")}>
                    {m.title}
                  </div>
                  {!m.completed ? (
                    <>
                      <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{m.description}</div>
                      <Link href={m.href} className="text-[11px] font-bold text-primary mt-1 inline-block">
                        {m.ctaLabel} ←
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
