// منطق خالصِ سمت کلاینت برای PWA/پوش (بدون DOM و بدون import) — با vitest بک‌اند آزمون می‌شود.

export type OsName = "ios" | "android" | "windows" | "mac" | "linux" | "other";
export type BrowserName = "chrome" | "safari" | "firefox" | "edge" | "samsung" | "opera" | "other";

export type PlatformInfo = {
  os: OsName;
  browser: BrowserName;
  /** مرورگر داخل اپ (اینستاگرام، تلگرام، WebView اندروید، …) — معمولاً نه نصب دارد نه پوش */
  inApp: string | null;
  /** نام فارسی برای نمایش، مثل «Chrome روی Android» */
  label: string;
};

export type EnvSnapshot = {
  ua: string;
  /** navigator.maxTouchPoints — برای iPadOS که خودش را Mac معرفی می‌کند */
  maxTouchPoints?: number;
  platform?: string;
};

export function detectPlatform(env: EnvSnapshot): PlatformInfo {
  const ua = env.ua || "";
  const ipadOs = /Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1;
  const os: OsName = /iPhone|iPad|iPod/i.test(ua) || ipadOs
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : /Windows/i.test(ua)
        ? "windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "mac"
          : /Linux|CrOS/i.test(ua)
            ? "linux"
            : "other";
  const browser: BrowserName = /SamsungBrowser/i.test(ua)
    ? "samsung"
    : /EdgA?\/|Edg\//i.test(ua)
      ? "edge"
      : /OPR\/|Opera/i.test(ua)
        ? "opera"
        : /Firefox|FxiOS/i.test(ua)
          ? "firefox"
          : /CriOS|Chrome\//i.test(ua)
            ? "chrome"
            : /Safari\//i.test(ua)
              ? "safari"
              : "other";
  let inApp: string | null = null;
  const m = /(Instagram|FBAN|FBAV|Line\/|Snapchat|Twitter|MicroMessenger|Telegram|Eitaa|Bale|Rubika|GSA\/)/i.exec(ua);
  if (m) inApp = m[1];
  else if (/; wv\)/.test(ua) || (browser === "chrome" && /Android/.test(ua) && /Version\/\d/.test(ua))) inApp = "WebView";
  const osFa: Record<OsName, string> = { ios: "iOS", android: "Android", windows: "Windows", mac: "macOS", linux: "Linux", other: "نامشخص" };
  const brFa: Record<BrowserName, string> = { chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge", samsung: "Samsung Internet", opera: "Opera", other: "مرورگر" };
  return { os, browser, inApp, label: `${brFa[browser]} روی ${osFa[os]}` };
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** کلید VAPID اشتراک موجود با کلید فعلی سرور یکی است؟ (برای تشخیص چرخش کلید) */
export function vapidKeyMatches(subscriptionKey: ArrayBuffer | Uint8Array | null | undefined, serverKeyB64Url: string | null | undefined): boolean {
  if (!subscriptionKey || !serverKeyB64Url) return true; // اطلاعاتی برای مقایسه نیست ⇒ مشکل ثابت‌شده‌ای هم نیست
  return bytesToBase64Url(subscriptionKey) === serverKeyB64Url.replace(/=+$/, "");
}

// ── backoff پیشنهاد نصب/اعلان ────────────────────────────────────────────────
export const PROMPT_BACKOFF_DAYS = [3, 7, 14, 30];

/** پس از n‌امین «بعداً»، چند روز دیگر مزاحم نشویم. بعد از سقف، همان ۳۰ روز. */
export function promptDelayMs(dismissCount: number): number {
  const i = Math.min(Math.max(dismissCount, 1), PROMPT_BACKOFF_DAYS.length) - 1;
  return PROMPT_BACKOFF_DAYS[i] * 86400_000;
}

export function shouldShowPrompt(state: { dismissedAt: number | null; dismissCount: number }, now: number): boolean {
  if (!state.dismissedAt || state.dismissCount <= 0) return true;
  return now - state.dismissedAt >= promptDelayMs(state.dismissCount);
}

// ── ارزیابی پشتیبانی پوش ─────────────────────────────────────────────────────
export type PushSupport =
  | { state: "ready" }
  | { state: "insecure"; reason: string }
  | { state: "in-app-browser"; reason: string }
  | { state: "ios-needs-install"; reason: string }
  | { state: "ios-too-old"; reason: string }
  | { state: "unsupported"; reason: string };

export type SupportInput = {
  platform: PlatformInfo;
  secureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  standalone: boolean;
};

export function assessPushSupport(i: SupportInput): PushSupport {
  if (!i.secureContext) {
    return { state: "insecure", reason: "پوش و نصب برنامه فقط روی اتصال امن (HTTPS) کار می‌کنند. آدرس را با https:// باز کنید." };
  }
  if (i.platform.inApp) {
    return { state: "in-app-browser", reason: `این صفحه داخل مرورگرِ درون‌برنامه‌ای (${i.platform.inApp}) باز شده و پوش پشتیبانی نمی‌شود. از منوی ⋮ گزینه‌ی «باز کردن در مرورگر» را بزنید.` };
  }
  if (i.platform.os === "ios") {
    if (!i.hasServiceWorker) return { state: "ios-too-old", reason: "پوش روی آیفون/آیپد به iOS نسخه‌ی ۱۶٫۴ یا بالاتر نیاز دارد. سیستم‌عامل را به‌روز کنید." };
    if (!i.standalone) {
      return { state: "ios-needs-install", reason: "روی آیفون/آیپد اعلان فقط برای برنامه‌ی «افزوده‌شده به صفحه‌ی اصلی» کار می‌کند. ابتدا برنامه را نصب کنید و از آیکون صفحه‌ی اصلی باز کنید." };
    }
    if (!i.hasPushManager || !i.hasNotification) return { state: "ios-too-old", reason: "پوش روی این نسخه‌ی iOS در دسترس نیست؛ iOS ۱۶٫۴ یا بالاتر لازم است." };
    return { state: "ready" };
  }
  if (!i.hasServiceWorker || !i.hasPushManager || !i.hasNotification) {
    return { state: "unsupported", reason: "این مرورگر از پوش وب پشتیبانی نمی‌کند. Chrome، Edge، Firefox یا Safari به‌روز را امتحان کنید." };
  }
  return { state: "ready" };
}

/** راهنمای رفع «مسدود شده» (denied) بر اساس مرورگر/سیستم‌عامل. */
export function deniedRecoverySteps(p: PlatformInfo): string[] {
  if (p.os === "ios") {
    return ["تنظیمات آیفون را باز کنید", "پایین بروید و «اکسیر ERP» (برنامه‌ی افزوده‌شده) را انتخاب کنید", "«Notifications» را روشن و «Allow Notifications» را فعال کنید", "به برنامه برگردید و دوباره «فعال‌سازی» را بزنید"];
  }
  if (p.browser === "samsung") return ["منوی ≡ ← تنظیمات ← «سایت‌ها و دانلودها» ← «مجوز سایت‌ها» ← «اعلان‌ها»", "این سایت را در لیست «مسدود» پیدا و روی «اجازه» بگذارید", "صفحه را دوباره بارگذاری کنید"];
  if (p.os === "android") return ["روی نماد قفل کنار آدرس بزنید ← «تنظیمات سایت» (Site settings)", "«اعلان‌ها» (Notifications) را روی «اجازه» بگذارید", "اگر برنامه نصب شده: تنظیمات گوشی ← برنامه‌ها ← اکسیر ← اعلان‌ها را روشن کنید", "صفحه را دوباره بارگذاری کنید"];
  if (p.browser === "firefox") return ["روی نماد قفل کنار آدرس بزنید ← «Clear permission / مجوزها»", "اجازه‌ی «Receive notifications» را حذف یا روی «Allow» بگذارید", "صفحه را دوباره بارگذاری کنید"];
  if (p.browser === "safari") return ["Safari ← Settings ← Websites ← Notifications", "این سایت را روی «Allow» بگذارید", "صفحه را دوباره بارگذاری کنید"];
  return ["روی نماد قفل (یا تنظیمات) کنار آدرس بزنید ← «Site settings»", "«Notifications» را روی «Allow» بگذارید", "اگر ویندوز/مک اعلان‌های مرورگر را خاموش کرده: Focus Assist / Do Not Disturb را بررسی کنید", "صفحه را دوباره بارگذاری کنید"];
}

/** دستورالعمل نصب iOS (اشتراک‌گذاری ← افزودن به صفحه‌ی اصلی). */
export function iosInstallSteps(browser: BrowserName): string[] {
  if (browser !== "safari") return ["این صفحه را در Safari باز کنید (نصب برنامه فقط از Safari ممکن است)"];
  return ["روی دکمه‌ی اشتراک‌گذاری (مربع با فلش رو به بالا) پایین صفحه بزنید", "گزینه‌ی «Add to Home Screen / افزودن به صفحه‌ی اصلی» را انتخاب کنید", "«Add» را بزنید", "برنامه را از آیکون صفحه‌ی اصلی باز کنید و در آنجا اعلان را فعال کنید"];
}

// ── مسیرهای عمیق (deep link) ─────────────────────────────────────────────────
/** پارامترهای ?reminder=…&act=… که SW برای دکمه‌های اعلان باز می‌کند. */
export function parseReminderAction(search: string): { id: string; act: "done" | "snooze" } | null {
  const sp = new URLSearchParams(search);
  const id = sp.get("reminder");
  const act = sp.get("act");
  if (!id || !/^[0-9a-fA-F-]{8,64}$/.test(id)) return null;
  if (act !== "done" && act !== "snooze") return null;
  return { id, act };
}

/** مقصد سرویس‌ورکر فقط مسیر درون‌برنامه‌ای باشد (جلوگیری از open redirect). */
export function isSafeInternalPath(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 1024 || !u.startsWith("/") || u.startsWith("//") || u.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(u)) return false;
  try {
    const base = "https://internal.invalid";
    return new URL(u, base).origin === base;
  } catch {
    return false;
  }
}
