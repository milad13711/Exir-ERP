"use client";

import { API_URL, fetchPushVapidKey, subscribePush, unsubscribePush } from "./api";
import {
  assessPushSupport,
  bytesToBase64Url,
  detectPlatform,
  shouldShowPrompt,
  urlBase64ToUint8Array,
  vapidKeyMatches,
  type PlatformInfo,
  type PushSupport,
} from "./push-client-pure";

export * from "./push-client-pure";

const OPTOUT_KEY = "exir-push-optout"; // کاربر روی همین دستگاه صراحتاً خاموش کرده ⇒ همگام‌سازی خودکار دوباره روشن نکند
const SYNC_KEY = "exir-push-synced-at";
const PROMPT_KEY = "exir-push-prompt-v2";
const INSTALL_PROMPT_KEY = "exir-install-prompt-v2";
const SYNC_INTERVAL_MS = 12 * 3600_000;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* حالت خصوصی/مسدود */
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || window.matchMedia?.("(display-mode: window-controls-overlay)").matches || nav.standalone === true;
}

export function getPlatform(): PlatformInfo {
  if (typeof navigator === "undefined") return detectPlatform({ ua: "" });
  return detectPlatform({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, platform: navigator.platform });
}

export function getPushSupport(): PushSupport {
  return assessPushSupport({
    platform: getPlatform(),
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    hasNotification: typeof window !== "undefined" && "Notification" in window,
    standalone: isStandalone(),
  });
}

// ── backoff پیشنهادها ────────────────────────────────────────────────────────
type PromptMemory = { dismissedAt: number | null; dismissCount: number };

function readPrompt(key: string): PromptMemory {
  try {
    const v = JSON.parse(lsGet(key) ?? "null");
    if (v && typeof v.dismissCount === "number") return { dismissedAt: v.dismissedAt ?? null, dismissCount: v.dismissCount };
  } catch {
    /* پیش‌فرض */
  }
  return { dismissedAt: null, dismissCount: 0 };
}

export function canShowPrompt(kind: "push" | "install"): boolean {
  return shouldShowPrompt(readPrompt(kind === "push" ? PROMPT_KEY : INSTALL_PROMPT_KEY), Date.now());
}

export function dismissPrompt(kind: "push" | "install") {
  const key = kind === "push" ? PROMPT_KEY : INSTALL_PROMPT_KEY;
  const cur = readPrompt(key);
  lsSet(key, JSON.stringify({ dismissedAt: Date.now(), dismissCount: cur.dismissCount + 1 }));
}

// ── نصب برنامه (beforeinstallprompt باید زود گرفته شود؛ رویداد فقط یک‌بار و معمولاً پیش از mount ریاکت می‌آید) ──
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let installEvent: InstallEvent | null = null;
let installed = false;
const installListeners = new Set<() => void>();
let installCaptureStarted = false;

export function initInstallCapture() {
  if (typeof window === "undefined" || installCaptureStarted) return;
  installCaptureStarted = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    installEvent = null;
    installListeners.forEach((l) => l());
  });
}

export function subscribeInstallState(cb: () => void): () => void {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}

export function getInstallState(): { canPrompt: boolean; installed: boolean } {
  return { canPrompt: installEvent !== null, installed: installed || isStandalone() };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = installEvent;
  if (!ev) return "unavailable";
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    installEvent = null;
    installListeners.forEach((l) => l());
    return choice.outcome;
  } catch {
    return "dismissed";
  }
}

// ── سرویس‌ورکر ───────────────────────────────────────────────────────────────
export function swUrl(): string {
  return `/sw.js?api=${encodeURIComponent(API_URL)}`;
}

/** registration آماده؛ اگر SW ثبت نشده (مثلاً توسعه‌ی محلی) به‌جای معلق‌ماندن، پس از مهلت null. */
export async function getReadyRegistration(timeoutMs = 6000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  } catch {
    return null;
  }
}

/** متادیتای مورد نیاز SW هنگام pushsubscriptionchange (توکن دستگاه + کلید عمومی) در Cache API. */
async function writePushMeta(meta: { rotateToken?: string | null; publicKey?: string | null }) {
  try {
    const cache = await caches.open("exir-meta");
    await cache.put("/__exir_push_meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  } catch {
    /* بدون Cache API فقط چرخش خودکار بی‌توکن ممکن نیست */
  }
}

// ── اشتراک ───────────────────────────────────────────────────────────────────
export type SubscribeOutcome =
  | { ok: true; endpoint: string }
  | { ok: false; reason: "unsupported" | "not-configured" | "denied" | "dismissed" | "no-sw" | "error"; detail?: string };

async function subscribeWithServerKey(reg: ServiceWorkerRegistration, publicKey: string, label?: string): Promise<SubscribeOutcome> {
  let sub = await reg.pushManager.getSubscription();
  // کلید VAPID عوض شده؟ اشتراک قدیمی هرگز نمی‌رسد ⇒ لغو و تازه
  if (sub && !vapidKeyMatches(sub.options?.applicationServerKey, publicKey)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
  }
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh ?? (sub.getKey("p256dh") ? bytesToBase64Url(sub.getKey("p256dh")!) : "");
  const auth = json.keys?.auth ?? (sub.getKey("auth") ? bytesToBase64Url(sub.getKey("auth")!) : "");
  if (!p256dh || !auth) return { ok: false, reason: "error", detail: "کلیدهای اشتراک ناقص است" };
  const res = await subscribePush({ endpoint: sub.endpoint, p256dh, auth, label });
  await writePushMeta({ rotateToken: res.rotateToken ?? null, publicKey });
  lsSet(SYNC_KEY, String(Date.now()));
  return { ok: true, endpoint: sub.endpoint };
}

/** فعال‌سازی با اجازه‌ی کاربر — فقط از داخل یک رویداد کلیک (iOS/Safari بدون gesture اجازه نمی‌دهد). */
export async function enablePushOnThisDevice(label?: string): Promise<SubscribeOutcome> {
  const support = getPushSupport();
  if (support.state !== "ready") return { ok: false, reason: "unsupported", detail: support.reason };
  try {
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission === "denied") return { ok: false, reason: "denied" };
    if (permission !== "granted") return { ok: false, reason: "dismissed" };
    const { publicKey, configured } = await fetchPushVapidKey();
    if (!configured || !publicKey) return { ok: false, reason: "not-configured" };
    const reg = await getReadyRegistration();
    if (!reg) return { ok: false, reason: "no-sw" };
    const out = await subscribeWithServerKey(reg, publicKey, label);
    if (out.ok) lsSet(OPTOUT_KEY, null);
    return out;
  } catch (err) {
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * پس از ورود (و هر ۱۲ ساعت/بازگشت به برنامه): اگر اجازه از قبل داده شده، اشتراک همین دستگاه را روی سرور تازه/ثبت می‌کند —
 * بدون هیچ پرسشی از کاربر. اگر کاربر همین دستگاه را خودش خاموش کرده، کاری نمی‌کند.
 */
export async function syncPushOnThisDevice(opts: { force?: boolean } = {}): Promise<void> {
  try {
    if (getPushSupport().state !== "ready") return;
    if (Notification.permission !== "granted" || lsGet(OPTOUT_KEY) === "1") return;
    if (!opts.force && Date.now() - Number(lsGet(SYNC_KEY) ?? 0) < SYNC_INTERVAL_MS) return;
    const { publicKey, configured } = await fetchPushVapidKey();
    if (!configured || !publicKey) return;
    const reg = await getReadyRegistration();
    if (!reg) return;
    await subscribeWithServerKey(reg, publicKey);
  } catch {
    /* بعداً دوباره */
  }
}

async function clearMeta() {
  lsSet(SYNC_KEY, null);
  try {
    await (await caches.open("exir-meta")).delete("/__exir_push_meta");
  } catch {
    /* ok */
  }
}

/**
 * پایان نشست بدون خروج صریح (۴۰۱/انقضا): سمت سرور بدون توکن ممکن نیست، پس همین‌جا بی‌قیدوشرط متادیتای محلی (توکن چرخش) پاک
 * و اشتراک محلی مرورگر لغو می‌شود تا ردیف سرور دیگر به این دستگاه نرسد (۴۱۰ ⇒ حذف). با ورود کاربر بعدی اشتراک جدید به او منتقل می‌شود.
 */
export async function clearPushLocalState(): Promise<void> {
  await clearMeta();
  try {
    const reg = await getReadyRegistration(1500);
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe().catch(() => false);
  } catch {
    /* ok */
  }
}

let sessionCleanupWired = false;
export function initSessionCleanup() {
  if (typeof window === "undefined" || sessionCleanupWired) return;
  sessionCleanupWired = true;
  window.addEventListener("exir:session-ended", () => void clearPushLocalState());
}

async function removeLocalAndServer(mark: "optout" | "logout"): Promise<void> {
  try {
    const reg = await getReadyRegistration(2500);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) {
      await clearMeta();
      return;
    }
    await Promise.race([unsubscribePush(sub.endpoint).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    await sub.unsubscribe().catch(() => false);
    if (mark === "optout") lsSet(OPTOUT_KEY, "1");
    await clearMeta();
  } catch {
    await clearMeta();
  }
}

/** خاموش‌کردن توسط کاربر برای همین دستگاه (به‌خاطر سپرده می‌شود). */
export const disablePushOnThisDevice = () => removeLocalAndServer("optout");

/** هنگام خروج از حساب: اشتراک همین دستگاه از حساب جدا شود تا اعلان‌ها به کاربر بعدیِ همین گوشی/کامپیوتر درز نکند. */
export const unsubscribeForLogout = () => removeLocalAndServer("logout");

export function isPushOptedOut(): boolean {
  return lsGet(OPTOUT_KEY) === "1";
}

// ── عیب‌یابی کلاینت ──────────────────────────────────────────────────────────
export type LocalPushDiagnostics = {
  secure: boolean;
  permission: NotificationPermission | "unsupported";
  swSupported: boolean;
  swRegistered: boolean;
  swActive: boolean;
  swScope: string | null;
  swScript: string | null;
  pushManager: boolean;
  standalone: boolean;
  platform: PlatformInfo;
  support: PushSupport;
  endpoint: string | null;
  keyMatchesServer: boolean | null;
  optedOut: boolean;
  online: boolean;
  appBadgeSupported: boolean;
};

export async function collectLocalDiagnostics(serverPublicKey: string | null): Promise<LocalPushDiagnostics> {
  const swSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = swSupported ? await navigator.serviceWorker.getRegistration() : undefined;
  } catch {
    reg = undefined;
  }
  let sub: PushSubscription | null = null;
  try {
    sub = (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    sub = null;
  }
  return {
    secure: typeof window !== "undefined" && window.isSecureContext,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    swSupported,
    swRegistered: Boolean(reg),
    swActive: Boolean(reg?.active),
    swScope: reg?.scope ?? null,
    swScript: reg?.active?.scriptURL ?? null,
    pushManager: typeof window !== "undefined" && "PushManager" in window,
    standalone: isStandalone(),
    platform: getPlatform(),
    support: getPushSupport(),
    endpoint: sub?.endpoint ?? null,
    keyMatchesServer: sub ? vapidKeyMatches(sub.options?.applicationServerKey, serverPublicKey) : null,
    optedOut: isPushOptedOut(),
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    appBadgeSupported: typeof navigator !== "undefined" && "setAppBadge" in navigator,
  };
}

/** «اصلاح خودکار»: SW را به‌روز، اشتراک قدیمی/ناهمخوان را لغو و دوباره بساز (فقط اگر اجازه از قبل داده شده). */
export async function autoRepairPush(): Promise<SubscribeOutcome> {
  try {
    const reg = await getReadyRegistration(4000);
    await reg?.update().catch(() => undefined);
    const old = await reg?.pushManager.getSubscription();
    if (old) {
      await unsubscribePush(old.endpoint).catch(() => undefined);
      await old.unsubscribe().catch(() => false);
    }
    lsSet(OPTOUT_KEY, null);
    return await enablePushOnThisDevice();
  } catch (err) {
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** badge آیکون برنامه (اگر پشتیبانی شود). */
export function setAppBadge(count: number) {
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    /* پشتیبانی نمی‌شود */
  }
}
