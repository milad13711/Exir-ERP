"use client";

import { useSyncExternalStore } from "react";
import {
  fetchNotificationAttention,
  fetchNotificationPreferences,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsDelivered,
  type AppNotification,
  type NotificationAttention,
  type NotificationPreferences,
} from "@/lib/api";
import { detectArrivals, isImportant, nextPollDelay, toastDecision, type ToastDecision } from "@/lib/notification-logic";
import { playNotificationSound } from "@/lib/notification-sound";

/**
 * منبع واحد وضعیت اعلان‌ها برای زنگوله، توست، بنر داشبورد، نشان منو، عنوان تب و badge برنامه.
 * فقط یک حلقه‌ی poll (آگاه از visibility، با backoff) — جایگزین poll مستقل زنگوله. هر کدام از اجزا فقط از hookها می‌خوانند.
 */
export type NotificationState = {
  loaded: boolean;
  unreadCount: number;
  importantUnread: number;
  items: AppNotification[];
  attention: NotificationAttention | null;
  prefs: NotificationPreferences | null;
  /** با هر ورود اعلان جدید یکی زیاد می‌شود (برای انیمیشن زنگ زنگوله) */
  arrivalTick: number;
};

export type Arrival = { n: AppNotification; decision: ToastDecision };

let state: NotificationState = { loaded: false, unreadCount: 0, importantUnread: 0, items: [], attention: null, prefs: null, arrivalTick: 0 };
const listeners = new Set<() => void>();
const arrivalListeners = new Set<(a: Arrival[]) => void>();
const seen = new Set<string>();
const acked = new Set<string>();
const pendingAck = new Set<string>();
let ackTimer: ReturnType<typeof setTimeout> | null = null;
let firstLoadDone = false;
let users = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let failures = 0;
let lastActivity = 0;
let prefsAt = 0;
let attentionKey = "";
let attentionAt = 0;
let teardown: (() => void) | null = null;

function emit() {
  for (const l of listeners) l();
}
function set(patch: Partial<NotificationState>) {
  state = { ...state, ...patch };
  emit();
}

export function getNotificationState(): NotificationState {
  return state;
}
export function subscribeNotificationState(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function subscribeArrivals(l: (a: Arrival[]) => void): () => void {
  arrivalListeners.add(l);
  return () => arrivalListeners.delete(l);
}

const SERVER_STATE: NotificationState = { loaded: false, unreadCount: 0, importantUnread: 0, items: [], attention: null, prefs: null, arrivalTick: 0 };
export function useNotificationState(): NotificationState {
  return useSyncExternalStore(subscribeNotificationState, getNotificationState, () => SERVER_STATE);
}

function queueDeliveredAck(list: AppNotification[]) {
  for (const n of list) if (!n.deliveredAt && !n.readAt && !acked.has(n.id)) pendingAck.add(n.id);
  if (pendingAck.size === 0 || ackTimer) return;
  ackTimer = setTimeout(() => {
    ackTimer = null;
    const ids = [...pendingAck].slice(0, 100);
    pendingAck.clear();
    ids.forEach((id) => acked.add(id));
    markNotificationsDelivered(ids).catch(() => ids.forEach((id) => acked.delete(id)));
  }, 1200);
}

export async function refreshNotifications(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const now = Date.now();
    if (!state.prefs || now - prefsAt > 60_000) {
      prefsAt = now;
      fetchNotificationPreferences().then((prefs) => set({ prefs })).catch(() => {});
    }
    const data = await fetchNotifications();
    const important = data.importantUnread ?? data.items.filter((n) => !n.readAt && isImportant(n)).length;
    let arrivals: Arrival[] = [];
    if (!firstLoadDone) {
      // اولین بار: فقط ثبت می‌شود؛ اعلان‌های قدیمیِ نخوانده هنگام ورود توست نمی‌شوند (در بنر/زنگوله هستند)
      data.items.forEach((n) => seen.add(n.id));
      firstLoadDone = true;
    } else {
      const fresh = detectArrivals(data.items, seen);
      data.items.forEach((n) => seen.add(n.id));
      arrivals = fresh.map((n) => ({ n, decision: toastDecision(n, state.prefs) })).filter((a) => a.decision.show);
    }
    // attention فقط وقتی شمارنده‌ها عوض شد (یا هر ۶۰ ثانیه) تازه می‌شود تا هر poll دو درخواست نشود
    const key = `${data.unreadCount}:${important}`;
    const needAttention = !state.attention || key !== attentionKey || now - attentionAt > 60_000;
    set({
      loaded: true,
      unreadCount: data.unreadCount,
      importantUnread: important,
      items: data.items,
      arrivalTick: arrivals.length ? state.arrivalTick + 1 : state.arrivalTick,
    });
    if (needAttention) {
      attentionKey = key;
      attentionAt = now;
      fetchNotificationAttention().then((attention) => set({ attention })).catch(() => {});
    }
    queueDeliveredAck(data.items);
    if (arrivals.length) {
      if (arrivals.some((a) => a.decision.sound)) playNotificationSound();
      for (const l of arrivalListeners) l(arrivals);
    }
    failures = 0;
  } catch {
    failures++;
  } finally {
    inFlight = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (users === 0) return;
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  timer = setTimeout(async () => {
    await refreshNotifications();
    schedule();
  }, nextPollDelay({ visible, idleMs: Date.now() - lastActivity, failures }));
}

function kick() {
  void refreshNotifications().finally(schedule);
}

/** یک بار در layout نصب می‌شود (reference-counted). */
export function startNotificationStore(): () => void {
  users++;
  if (users === 1) {
    lastActivity = Date.now();
    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity > 2 * 60_000;
      lastActivity = Date.now();
      if (wasIdle) kick();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
      else schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", kick);
    window.addEventListener("online", kick);
    // سرویس‌ورکر خبر داد پوش رسیده (برنامه باز است): بدون انتظار برای poll بعدی
    window.addEventListener("exir:push-received", kick);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    kick();
    teardown = () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", kick);
      window.removeEventListener("exir:push-received", kick);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }
  return () => {
    users = Math.max(0, users - 1);
    if (users === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      teardown?.();
      teardown = null;
      firstLoadDone = false;
      seen.clear();
    }
  };
}

/** خواندن خوش‌بینانه: شمارنده فوراً کم می‌شود، بعد سرور تأیید می‌کند. */
export async function markRead(id: string): Promise<void> {
  const target = state.items.find((n) => n.id === id);
  if (target && !target.readAt) {
    const wasImportant = isImportant(target);
    set({
      items: state.items.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
      importantUnread: wasImportant ? Math.max(0, state.importantUnread - 1) : state.importantUnread,
      attention: state.attention ? { ...state.attention, items: state.attention.items.filter((n) => n.id !== id) } : state.attention,
    });
  }
  try {
    await markNotificationRead(id);
  } finally {
    attentionAt = 0;
    void refreshNotifications();
  }
}

export async function markAllRead(): Promise<void> {
  const nowIso = new Date().toISOString();
  set({
    items: state.items.map((n) => (n.readAt ? n : { ...n, readAt: nowIso })),
    unreadCount: 0,
    importantUnread: 0,
    attention: state.attention ? { ...state.attention, items: [], total: 0, importantTotal: 0, byCategory: {}, byLink: {} } : state.attention,
  });
  try {
    await markAllNotificationsRead();
  } finally {
    attentionAt = 0;
    void refreshNotifications();
  }
}
