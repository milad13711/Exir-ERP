"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPushVapidKey } from "@/lib/api";
import {
  deniedRecoverySteps,
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getPlatform,
  getPushSupport,
  getReadyRegistration,
  type PushSupport,
} from "@/lib/push-client";
import { toPersianDigits } from "@/lib/persian";

type State = "loading" | "off" | "on" | "denied" | "unsupported" | "unavailable";

export function Toggle({ checked, onClick, disabled }: { checked: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${checked ? "bg-primary" : "bg-slate-200"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[-22px]" : "translate-x-[-2px]"}`}
        style={{ right: 0 }}
      />
    </button>
  );
}

/** پوش روی همین دستگاه/مرورگر: روشن/خاموش + توضیح دقیق وقتی ممکن نیست (iOS نصب‌نشده، مسدود، مرورگر درون‌برنامه‌ای، …). */
export function PushNotificationRow({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<State>("loading");
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = getPushSupport();
    setSupport(s);
    if (s.state !== "ready") return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const { configured } = await fetchPushVapidKey().catch(() => ({ configured: false }));
    if (!configured) return setState("unavailable");
    const reg = await getReadyRegistration(4000);
    const sub = await reg?.pushManager.getSubscription();
    setState(sub && Notification.permission === "granted" ? "on" : "off");
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  async function enable() {
    setState("loading");
    setError(null);
    const out = await enablePushOnThisDevice();
    if (!out.ok) {
      setError(
        out.reason === "denied"
          ? null
          : out.reason === "not-configured"
            ? "پوش روی سرور پیکربندی نشده است (کلید VAPID)."
            : out.reason === "no-sw"
              ? "سرویس‌ورکر آماده نیست؛ صفحه را بازخوانی کنید (در حالت توسعه غیرفعال است)."
              : (out.detail ?? "فعال‌سازی انجام نشد"),
      );
    }
    await refresh();
    onChanged?.();
  }

  async function disable() {
    setState("loading");
    await disablePushOnThisDevice();
    await refresh();
    onChanged?.();
  }

  if (state === "unavailable") {
    return (
      <div className="px-4 py-4 border-b border-border text-[12px] text-muted leading-6">
        پوش نوتیفیکیشن روی سرور فعال نشده است (کلید VAPID تنظیم نشده). با پشتیبانی تماس بگیرید.
      </div>
    );
  }

  const steps = state === "denied" ? deniedRecoverySteps(getPlatform()) : [];

  return (
    <div className="px-4 py-4 border-b border-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-bold">پوش نوتیفیکیشن روی این دستگاه</div>
          <div className="text-[11.5px] text-muted mt-0.5 leading-5">
            {state === "unsupported" && support && support.state !== "ready"
              ? support.reason
              : state === "denied"
                ? "اعلان برای این سایت مسدود شده است. طبق مراحل زیر آن را باز کنید:"
                : "حتی وقتی برنامه بسته است، اعلان پیام‌رسان، یادآوری‌ها و وظایف روی این دستگاه نمایش داده می‌شود"}
          </div>
        </div>
        <Toggle
          checked={state === "on"}
          disabled={state === "loading" || state === "denied" || state === "unsupported"}
          onClick={state === "on" ? disable : enable}
        />
      </div>
      {steps.length ? (
        <ol className="mt-2.5 flex flex-col gap-1.5 text-[11.5px] leading-6 text-ink-soft">
          {steps.map((s, i) => (
            <li key={i}>
              {toPersianDigits(i + 1)}. {s}
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <div className="mt-2 text-[11.5px] text-danger">{error}</div> : null}
    </div>
  );
}
