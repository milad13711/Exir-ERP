"use client";

import { useEffect, useState } from "react";
import { PhoneIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { useVoipEngine } from "@/lib/use-voip-engine";
import { voipEngine } from "@/lib/voip-engine";

/**
 * نوار/کارت تماس زنده‌ی سافت‌فون مرورگری — هر جای اپ که کاربر باشد نمایش
 * داده می‌شود، دقیقاً مثل ویجت تلفن Odoo. فقط وقتی wssUrl تنظیم شده باشد
 * فعال است (voip-engine.ts)؛ در غیر این صورت هیچ‌چیزی رندر نمی‌شود و
 * تماس خروجی از همان originate سمت سرور (ویجت هدر) استفاده می‌کند.
 */
export function VoipCallOverlay() {
  const { installedModules } = useWorkspace();
  const enabled = installedModules.has("voip");
  const { callState, remoteNumber, remoteName, muted } = useVoipEngine(enabled);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (callState !== "connected") {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => setSeconds(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [callState]);

  if (!enabled || callState === "idle") return null;

  const label = remoteName ?? remoteNumber ?? "";

  if (callState === "ringing-incoming") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4">
        <div className="w-full max-w-[320px] bg-surface rounded-3xl shadow-2xl p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-soft text-primary flex items-center justify-center animate-pulse">
            <PhoneIcon className="w-7 h-7" />
          </div>
          <div>
            <div className="text-[15px] font-bold">{label}</div>
            <div className="text-[12.5px] text-muted mt-1">تماس ورودی...</div>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <button
              onClick={() => voipEngine.decline()}
              className="w-14 h-14 rounded-full bg-danger text-white flex items-center justify-center cursor-pointer"
              aria-label="رد تماس"
            >
              <PhoneIcon className="w-6 h-6 rotate-[135deg]" />
            </button>
            <button
              onClick={() => voipEngine.answer()}
              className="w-14 h-14 rounded-full bg-success text-white flex items-center justify-center cursor-pointer"
              aria-label="پاسخ به تماس"
            >
              <PhoneIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="fixed bottom-5 inset-x-0 z-[60] flex justify-center px-4">
      <div className="flex items-center gap-3 bg-ink text-white rounded-2xl shadow-2xl px-4 py-3">
        <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center shrink-0">
          <PhoneIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold truncate">{label}</div>
          <div className="text-[11px] text-white/60" dir="ltr">
            {callState === "ringing-outgoing" ? "در حال تماس..." : `${mm}:${ss}`}
          </div>
        </div>
        {callState === "connected" ? (
          <button
            onClick={() => voipEngine.toggleMute()}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 cursor-pointer text-[11px] font-bold ${muted ? "bg-warning text-ink" : "bg-white/15"}`}
            aria-label="بی‌صدا"
          >
            {muted ? "🔇" : "🎙"}
          </button>
        ) : null}
        <button
          onClick={() => voipEngine.hangup()}
          className="w-8 h-8 rounded-full bg-danger flex items-center justify-center shrink-0 cursor-pointer"
          aria-label="پایان تماس"
        >
          <PhoneIcon className="w-3.5 h-3.5 rotate-[135deg]" />
        </button>
      </div>
    </div>
  );
}
