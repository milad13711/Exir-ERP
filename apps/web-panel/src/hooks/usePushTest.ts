"use client";

import { useCallback, useRef, useState } from "react";
import { fetchPushTestResult, sendPushTest, type PushTestResult } from "@/lib/api";

export type PushTestState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "sent"; result: PushTestResult; delivered: boolean; waited: boolean }
  | { phase: "error"; message: string };

/** اعلان آزمایشی انتها‌به‌انتها: ارسال به سرویس پوش (sent) ← رسیدن به دستگاه و ack سرویس‌ورکر (delivered). حداکثر ~۲۴ ثانیه منتظر ack می‌ماند. */
export function usePushTest() {
  const [state, setState] = useState<PushTestState>({ phase: "idle" });
  const run = useRef(0);

  const start = useCallback(async (subscriptionId?: string) => {
    const my = ++run.current;
    setState({ phase: "sending" });
    try {
      const result = await sendPushTest(subscriptionId);
      if (my !== run.current) return;
      if (!result.success || result.sent === 0) {
        setState({ phase: "sent", result, delivered: false, waited: false });
        return;
      }
      setState({ phase: "sent", result, delivered: false, waited: true });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (my !== run.current) return;
        const r = await fetchPushTestResult(result.notificationId).catch(() => null);
        if (r?.delivered) {
          setState({ phase: "sent", result, delivered: true, waited: false });
          return;
        }
      }
      setState({ phase: "sent", result, delivered: false, waited: false });
    } catch (err) {
      if (my === run.current) setState({ phase: "error", message: err instanceof Error ? err.message : "ارسال آزمایشی ناموفق بود" });
    }
  }, []);

  return { state, start };
}

export function describeTest(state: PushTestState): { tone: "ok" | "warn" | "bad" | "wait"; text: string } | null {
  if (state.phase === "idle") return null;
  if (state.phase === "sending") return { tone: "wait", text: "در حال ارسال…" };
  if (state.phase === "error") return { tone: "bad", text: state.message };
  const { result, delivered, waited } = state;
  if (!result.configured) return { tone: "bad", text: "پوش روی سرور پیکربندی نشده است (کلید VAPID)." };
  if (result.total === 0) return { tone: "bad", text: "هیچ دستگاهی ثبت نشده است. ابتدا «پوش روی این دستگاه» را روشن کنید." };
  if (result.sent === 0) {
    const first = result.results[0];
    return { tone: "bad", text: `ارسال ناموفق بود: ${first?.explanation ?? "نامشخص"}${first?.httpCode ? ` (کد ${first.httpCode})` : ""}` };
  }
  if (delivered) return { tone: "ok", text: "ارسال شد و رسیدن اعلان به دستگاه تأیید شد ✓" };
  if (waited) return { tone: "wait", text: "به سرویس پوش ارسال شد؛ منتظر تأیید رسیدن به دستگاه…" };
  return {
    tone: "warn",
    text: "به سرویس پوش ارسال شد ولی تأیید رسیدن نیامد. دستگاه ممکن است خاموش/آفلاین باشد، صرفه‌جویی باتری یا «مزاحم نشوید» فعال باشد، یا اعلان‌های برنامه در تنظیمات گوشی خاموش باشد.",
  };
}
