/**
 * هسته‌ی زنده‌ی پیام‌رسان برای کل برنامه (نه فقط صفحه‌ی /messenger).
 *
 * AppShell اگر ماژول `messenger` نصب باشد `startMessengerRuntime()` را صدا می‌زند و هنگام خروج/خاموشی ماژول
 * `stopMessengerRuntime()`. این ماژول (singleton، بدون React) مالک این‌هاست:
 *  - تنها سوکت `/messenger` تب (بدون تکرار) با اتصال مجدد خودکار؛ پس از قطعی/بازگشت تب «همگام‌سازی» می‌کند
 *    (فهرست گفتگو، شمارنده‌ی نخوانده و — از طریق onResync — پیام‌های ازدست‌رفته‌ی گفتگوی باز)؛
 *  - شمارنده‌ی نخوانده‌ی مشترک (منو، عنوان تب «(۳) …»، نشان آیکون برنامه)؛
 *  - اعلان درون‌برنامه‌ای (toast) برای پیام جدید وقتی همان گفتگو را نمی‌بینیم، با احترام به بی‌صدا و hidePreview؛
 *  - صدای اعلان (انتخاب کاربر، به‌ازای هر کاربر در localStorage).
 * اعلان پوش گوشی/سیستم‌عامل سمت سرور فقط وقتی کاربر تب قابل‌مشاهده ندارد ارسال می‌شود (gateway.isActive)،
 * پس در تب فعال دوباره‌اعلام نمی‌شود.
 */
import { getToken } from "./api";
import { toPersianDigits } from "./persian";
import { playNotificationSound } from "./notification-sound";
import { closeMessengerSocket, emitMessengerVisibility, getMessengerSocket, messengerApi, type MessengerMessage } from "./messenger-api";
import type { Socket } from "socket.io-client";

// ── انواع ─────────────────────────────────────────────────────────────

export type MessengerToast = {
  id: string;
  conversationId: string;
  title: string;
  sender: string;
  preview: string;
  seq: number;
  at: number;
};

type ConvMeta = { title: string; muted: boolean; type: "DIRECT" | "GROUP" | "SAVED"; lastSeq: number };

// ── وضعیت ─────────────────────────────────────────────────────────────

let started = false;
let myId: string | null = null;
let hidePreview = false;
let activeConv: string | null = null;
let boundSocket: Socket | null = null;
let needResync = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let unreadTimer: ReturnType<typeof setTimeout> | null = null;
let metaTimer: ReturnType<typeof setTimeout> | null = null;
let lastResync = 0;
let titleObserver: MutationObserver | null = null;
let applyingTitle = false;

const meta = new Map<string, ConvMeta>();
let metaInflight: Promise<void> | null = null;

let unreadTotal = 0;
const unreadListeners = new Set<() => void>();
let toasts: MessengerToast[] = [];
const toastListeners = new Set<() => void>();
const resyncListeners = new Set<(reason: string) => void>();
let opener: ((conversationId: string, focusComposer: boolean) => void) | null = null;
let navigator_: ((url: string) => void) | null = null;

const MAX_TOASTS = 3;
const TITLE_PREFIX_RE = /^\([\d۰-۹]+\+?\)\s/;

// ── شمارنده‌ی نخوانده ────────────────────────────────────────────────────

export function subscribeUnread(l: () => void): () => void {
  unreadListeners.add(l);
  return () => void unreadListeners.delete(l);
}
export function getUnreadSnapshot() {
  return unreadTotal;
}

function setUnread(n: number) {
  const v = Math.max(0, n);
  if (v === unreadTotal) return;
  unreadTotal = v;
  unreadListeners.forEach((l) => l());
  syncChrome();
}

export function setUnreadHint(n: number) {
  setUnread(n);
}

async function refreshUnreadNow() {
  try {
    setUnread((await messengerApi.unread()).total);
  } catch {
    /* بی‌صدا — شمارنده حیاتی نیست */
  }
}

function scheduleUnread(delay = 600) {
  if (unreadTimer) clearTimeout(unreadTimer);
  unreadTimer = setTimeout(() => void refreshUnreadNow(), delay);
}

/** از بیرون (مثلاً پس از خواندن گفتگو) برای به‌روزرسانی شمارنده. */
export function refreshMessengerUnread() {
  scheduleUnread(150);
}

// ── عنوان تب و نشان برنامه ───────────────────────────────────────────────

function desiredTitle(current: string) {
  const base = current.replace(TITLE_PREFIX_RE, "");
  return unreadTotal > 0 ? `(${toPersianDigits(unreadTotal > 99 ? "99+" : unreadTotal)}) ${base}` : base;
}

function applyTitle() {
  if (typeof document === "undefined") return;
  const want = desiredTitle(document.title);
  if (want !== document.title) {
    applyingTitle = true;
    document.title = want;
    applyingTitle = false;
  }
}

function syncChrome() {
  applyTitle();
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unreadTotal > 0) void nav.setAppBadge?.(unreadTotal).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch {
    /* مرورگر پشتیبانی نمی‌کند */
  }
}

function observeTitle() {
  if (titleObserver || typeof document === "undefined") return;
  const el = document.querySelector("title");
  if (!el) return;
  // Next عنوان صفحه را با هر مسیر عوض می‌کند؛ پیشوند تعداد باید دوباره اعمال شود
  titleObserver = new MutationObserver(() => {
    if (!applyingTitle) applyTitle();
  });
  titleObserver.observe(el, { childList: true, characterData: true, subtree: true });
}

// ── ترجیح صدا ────────────────────────────────────────────────────────

const soundKey = () => `exir-messenger-sound:${myId ?? "anon"}`;

export function getSoundEnabled(): boolean {
  try {
    return localStorage.getItem(soundKey()) !== "off";
  } catch {
    return true;
  }
}
export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(soundKey(), on ? "on" : "off");
  } catch {
    /* بی‌اهمیت */
  }
}

// ── اعلان درون‌برنامه‌ای ─────────────────────────────────────────────

export function subscribeToasts(l: () => void): () => void {
  toastListeners.add(l);
  return () => void toastListeners.delete(l);
}
export function getToastsSnapshot() {
  return toasts;
}
const EMPTY: MessengerToast[] = [];
export function getServerToastsSnapshot() {
  return EMPTY;
}

function setToasts(next: MessengerToast[]) {
  toasts = next;
  toastListeners.forEach((l) => l());
}

export function dismissToast(id: string) {
  if (toasts.some((t) => t.id === id)) setToasts(toasts.filter((t) => t.id !== id));
}
export function dismissToastsFor(conversationId: string) {
  if (toasts.some((t) => t.conversationId === conversationId)) setToasts(toasts.filter((t) => t.conversationId !== conversationId));
}

/** متن کوتاه پیام برای اعلان: «📷 تصویر / 📎 فایل / 🎤 پیام صوتی» یا خود متن. */
export function previewForMessage(m: Pick<MessengerMessage, "text" | "media" | "deleted">): string {
  if (m.deleted) return "این پیام حذف شد";
  const media = m.media;
  const label = !media ? "" : media.mime.startsWith("audio/") ? "🎤 پیام صوتی" : media.kind === "IMAGE" ? "📷 تصویر" : media.kind === "VIDEO" ? "🎞 ویدئو" : "📎 فایل";
  const text = (m.text ?? "").replace(/\s+/g, " ").trim();
  if (label && text) return `${label} — ${text.slice(0, 80)}`;
  return label || text.slice(0, 100);
}

function pushToast(m: MessengerMessage, info: ConvMeta | undefined) {
  const toast: MessengerToast = {
    id: m.id,
    conversationId: m.conversationId,
    title: info?.title ?? m.senderName,
    sender: info?.type === "GROUP" ? m.senderName : "",
    preview: hidePreview ? "پیام جدید" : previewForMessage(m),
    seq: m.seq,
    at: Date.now(),
  };
  // یک اعلان برای هر گفتگو (جدیدترین جایگزین می‌شود)، حداکثر ۳ تا
  setToasts([toast, ...toasts.filter((t) => t.conversationId !== m.conversationId)].slice(0, MAX_TOASTS));
}

// ── ناوبری (باز کردن گفتگو از اعلان/پوش) ───────────────────────────────

export function registerChatOpener(fn: ((conversationId: string, focusComposer: boolean) => void) | null) {
  opener = fn;
}
export function registerRouterNavigate(fn: ((url: string) => void) | null) {
  navigator_ = fn;
}
export function setActiveConversation(id: string | null) {
  activeConv = id;
  if (id) dismissToastsFor(id);
}

export function openConversationFromAnywhere(conversationId: string, focusComposer = false) {
  if (opener) opener(conversationId, focusComposer);
  else navigator_?.(`/messenger?c=${conversationId}${focusComposer ? "&focus=1" : ""}`);
}

function newClientId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** پاسخ سریع از اعلان؛ پس از موفقیت گفتگو «خوانده» می‌شود. */
export async function quickReply(conversationId: string, text: string, seq: number) {
  await messengerApi.send(conversationId, { text, clientId: newClientId() });
  await messengerApi.read(conversationId, seq).catch(() => undefined);
  dismissToastsFor(conversationId);
  scheduleUnread(200);
}

// ── همگام‌سازی ───────────────────────────────────────────────────────

export function onMessengerResync(fn: (reason: string) => void): () => void {
  resyncListeners.add(fn);
  return () => void resyncListeners.delete(fn);
}

async function refreshMeta(): Promise<void> {
  if (metaInflight) return metaInflight;
  metaInflight = messengerApi
    .conversations()
    .then((list) => {
      meta.clear();
      for (const c of list) meta.set(c.id, { title: c.title, muted: c.muted, type: c.type, lastSeq: c.lastSeq ?? 0 });
    })
    .catch(() => undefined)
    .finally(() => {
      metaInflight = null;
    });
  return metaInflight;
}

function scheduleMeta(delay = 500) {
  if (metaTimer) clearTimeout(metaTimer);
  metaTimer = setTimeout(() => void refreshMeta(), delay);
}

function triggerResync(reason: string) {
  const now = Date.now();
  if (now - lastResync < 1500) return;
  lastResync = now;
  void refreshMeta();
  void refreshUnreadNow();
  messengerApi.settings().then((s) => (hidePreview = s.hidePreview)).catch(() => undefined);
  resyncListeners.forEach((fn) => {
    try {
      fn(reason);
    } catch {
      /* شنونده‌ی خراب نباید بقیه را بشکند */
    }
  });
}

// ── رویداد پیام جدید ─────────────────────────────────────────────────

async function onNewMessage({ message }: { message: MessengerMessage }) {
  if (message.kind === "SYSTEM") return;
  if (myId && message.senderId === myId) {
    scheduleUnread(); // دستگاه دیگر خودم
    return;
  }
  let info = meta.get(message.conversationId);
  if (!info) {
    await refreshMeta();
    info = meta.get(message.conversationId);
  }
  const visible = document.visibilityState === "visible";
  if (activeConv === message.conversationId && visible) {
    scheduleUnread(); // MessengerApp خودش «خوانده» می‌کند
    return;
  }
  const mentioned = !!myId && message.mentionIds?.includes(myId);
  const muted = !!info?.muted && !mentioned;
  if (!muted) setUnread(unreadTotal + 1);
  scheduleUnread(900); // اصلاح خوش‌بینانه با مقدار واقعی سرور
  if (info) info.lastSeq = Math.max(info.lastSeq, message.seq);
  if (muted) return;
  if (visible) {
    pushToast(message, info);
    if (getSoundEnabled()) playNotificationSound();
  }
}

// ── اتصال سوکت ───────────────────────────────────────────────────────

function scheduleReconnect(s: Socket) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!started || s !== boundSocket || s.connected) return;
    s.connect();
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  }, reconnectDelay);
}

function bindSocket() {
  const s = getMessengerSocket();
  if (!s || s === boundSocket) return;
  unbindSocket();
  boundSocket = s;
  const onConnect = () => {
    reconnectDelay = 3000;
    if (needResync) {
      needResync = false;
      triggerResync("reconnect");
    }
  };
  const onDisconnect = (reason: string) => {
    needResync = true;
    // قطع از سمت سرور (مثلاً خطای موقت احراز هویت) خودکار وصل نمی‌شود
    if (reason === "io server disconnect") scheduleReconnect(s);
  };
  s.on("connect", onConnect);
  s.on("disconnect", onDisconnect);
  s.on("connect_error", () => {
    needResync = true;
  });
  s.on("message:new", (p: { message: MessengerMessage }) => void onNewMessage(p));
  s.on("receipt", () => scheduleUnread());
  s.on("message:hidden", () => scheduleUnread());
  s.on("conversation:updated", () => {
    scheduleMeta();
    scheduleUnread();
  });
  if (s.connected) onConnect();
}

function unbindSocket() {
  boundSocket?.removeAllListeners();
  boundSocket = null;
}

// ── محیط (تب/شبکه/توکن) ──────────────────────────────────────────────

function onVisibility() {
  emitMessengerVisibility();
  if (document.visibilityState === "visible") {
    bindSocket();
    if (boundSocket && !boundSocket.connected) boundSocket.connect();
    triggerResync("resume");
  }
}
function onOnline() {
  bindSocket();
  if (boundSocket && !boundSocket.connected) boundSocket.connect();
  triggerResync("online");
}
function onPageShow(e: PageTransitionEvent) {
  if (e.persisted) onVisibility();
}
function onStorage(e: StorageEvent) {
  // خروج از حساب در تب دیگر
  if (e.key === "exir_access_token" && !e.newValue) stopMessengerRuntime();
}
function onSwMessage(e: MessageEvent) {
  const d = e.data as { type?: string; conversationId?: string; focus?: boolean } | undefined;
  if (d?.type === "messenger-open" && typeof d.conversationId === "string") openConversationFromAnywhere(d.conversationId, !!d.focus);
}

export function startMessengerRuntime() {
  if (started || typeof window === "undefined" || !getToken()) return;
  started = true;
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("storage", onStorage);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);
  observeTitle();
  bindSocket();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      bindSocket();
      void refreshUnreadNow();
    }
  }, 60_000);
  void (async () => {
    try {
      const [me, settings] = await Promise.all([messengerApi.me(), messengerApi.settings()]);
      myId = me.userId;
      hidePreview = settings.hidePreview;
    } catch {
      /* ادامه بدون اطلاعات کاربر؛ تلاش بعدی با resync */
    }
    await Promise.all([refreshMeta(), refreshUnreadNow()]);
  })();
}

export function stopMessengerRuntime() {
  if (!started) return;
  started = false;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("pageshow", onPageShow);
  window.removeEventListener("storage", onStorage);
  navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  [reconnectTimer, unreadTimer, metaTimer].forEach((t) => t && clearTimeout(t));
  reconnectTimer = unreadTimer = metaTimer = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  titleObserver?.disconnect();
  titleObserver = null;
  unbindSocket();
  closeMessengerSocket();
  meta.clear();
  metaInflight = null;
  myId = null;
  activeConv = null;
  needResync = false;
  lastResync = 0;
  setToasts([]);
  setUnread(0);
}
