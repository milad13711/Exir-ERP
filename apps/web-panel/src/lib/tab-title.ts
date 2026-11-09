"use client";

/**
 * تنها مالک پیشوند عنوان تب «(۳) …» و نشان آیکون برنامه.
 *
 * قبلاً پیام‌رسان و اعلان‌ها هر کدام MutationObserver جدا روی <title> داشتند و هر کدام پیشوند دیگری را با عدد خودش
 * جایگزین می‌کرد؛ وقتی دو عدد فرق داشت، دو ناظر بی‌پایان همدیگر را بیدار می‌کردند و مرورگر کاملاً قفل می‌شد
 * (تننت‌هایی که ماژول پیام‌رسان دارند، نوامبر ۲۰۲۶). حالا هر منبع فقط عددش را ثبت می‌کند و همین‌جا مجموع با یک ناظر
 * و یک نویسنده اعمال می‌شود — نوشتن idempotent است، پس ناظر بعد از یک دور آرام می‌گیرد.
 */

const PREFIX_RE = /^\((?:[0-9۰-۹]+\+?)\)\s*/;
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const counts = new Map<string, number>();
let observer: MutationObserver | null = null;
let applying = false;
// ترمز اضطراری: اگر کد دیگری هم‌زمان عنوان را بازنویسی کند، به‌جای قفل‌کردن مرورگر کنار می‌کشیم
let writes = 0;
let windowStart = 0;
let tripped = false;

function toFa(s: string): string {
  return s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

function total(): number {
  let t = 0;
  for (const n of counts.values()) t += n;
  return t;
}

/** عنوان با پیشوند تعداد؛ پیشوند قبلی (هر منبعی) برداشته می‌شود. صفر ⇒ بدون پیشوند. */
export function composeTabTitle(title: string, count: number): string {
  const base = (title ?? "").replace(PREFIX_RE, "");
  if (!Number.isFinite(count) || count <= 0) return base;
  return `(${toFa(count > 99 ? "99+" : String(Math.floor(count)))}) ${base}`;
}

function apply() {
  if (typeof document === "undefined" || applying || tripped) return;
  const next = composeTabTitle(document.title, total());
  if (next === document.title) return;
  const now = Date.now();
  if (now - windowStart > 1000) {
    windowStart = now;
    writes = 0;
  }
  if (++writes > 20) {
    tripped = true;
    observer?.disconnect();
    observer = null;
    return;
  }
  applying = true;
  try {
    document.title = next;
  } finally {
    applying = false;
  }
}

function ensureObserver() {
  if (observer || tripped || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  // Next عنوان را با هر مسیر عوض می‌کند (گاهی خود <title> را جایگزین می‌کند) — کل head زیر نظر است
  observer = new MutationObserver(() => apply());
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function syncBadge() {
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const t = total();
    if (t > 0) void nav.setAppBadge?.(t)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    /* پشتیبانی نمی‌شود */
  }
}

/** تعداد یک منبع (مثلاً «notifications» یا «messenger») را ثبت می‌کند؛ عنوان و نشان برنامه مجموع همه را نشان می‌دهند. */
export function setTabTitleCount(source: string, count: number): void {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if ((counts.get(source) ?? 0) === n && (n > 0 || !counts.has(source))) return;
  if (n > 0) counts.set(source, n);
  else counts.delete(source);
  if (typeof document === "undefined") return;
  if (counts.size > 0) ensureObserver();
  apply();
  syncBadge();
  if (counts.size === 0) {
    observer?.disconnect();
    observer = null;
  }
}

/** فقط برای آزمون. */
export function _resetTabTitle(): void {
  counts.clear();
  observer?.disconnect();
  observer = null;
  applying = false;
  writes = 0;
  windowStart = 0;
  tripped = false;
}
