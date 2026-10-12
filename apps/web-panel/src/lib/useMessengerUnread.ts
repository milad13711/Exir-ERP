"use client";

import { useSyncExternalStore } from "react";
import { getUnreadSnapshot, subscribeUnread } from "./messenger-api";

const noop = () => () => {};

/** تعداد کل پیام‌های نخوانده (گفتگوهای بی‌صدا شمرده نمی‌شوند). `enabled=false` یعنی ماژول نصب نیست و هیچ درخواستی زده نمی‌شود. */
export function useMessengerUnread(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribeUnread : noop, () => (enabled ? getUnreadSnapshot() : 0), () => 0);
}
