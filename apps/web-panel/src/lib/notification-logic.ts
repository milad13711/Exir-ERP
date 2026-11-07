/**
 * منطق خالص دیده‌شدن اعلان‌ها (بدون React/DOM/import) — از backend-core/src/notifications/notification-client-logic.spec.ts آزمون می‌شود.
 * هر قاعده‌ی «چه چیزی، کی، چقدر چسبنده» اینجا است تا زنگوله، توست، بنر داشبورد و منو یک منبع واحد داشته باشند.
 */

export type NotifLike = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt: string | null;
  createdAt: string;
  category?: string | null;
  important?: boolean | null;
  entityType?: string | null;
  entityId?: string | null;
};

export type PrefsLike = {
  toastEnabled?: boolean;
  soundEnabled?: boolean;
  quietHoursEnabled?: boolean;
  quietStart?: string;
  quietEnd?: string;
  categoryPrefs?: Record<string, { push?: boolean; inApp?: boolean; sms?: boolean } | undefined>;
};

const FA = "۰۱۲۳۴۵۶۷۸۹";
export const toFa = (v: string | number) => String(v).replace(/[0-9]/g, (d) => FA[Number(d)]);

export const CATEGORY_LABEL: Record<string, string> = {
  messenger: "پیام‌رسان",
  tasks: "وظایف",
  reminders: "یادآوری‌ها",
  correspondence: "مکاتبات",
  approvals: "تأییدیه‌ها",
  referrals: "ارجاع‌ها",
  system: "سیستم",
  marketing: "بازاریابی",
};

/** دسته‌ی اعلان؛ ردیف‌های قدیمی بدون category از پیشوند type حدس زده می‌شوند (همان قاعده‌ی سرور). */
export function categoryOf(n: Pick<NotifLike, "type" | "category">): string {
  if (n.category && CATEGORY_LABEL[n.category]) return n.category;
  const t = (n.type ?? "").toLowerCase();
  if (t.startsWith("messenger")) return "messenger";
  if (t.startsWith("task")) return "tasks";
  if (t.startsWith("reminder") || t.startsWith("calendar") || t.startsWith("checklist")) return "reminders";
  if (t.startsWith("correspondence") || t.startsWith("letter")) return "correspondence";
  if (t.startsWith("approval") || t.startsWith("leave")) return "approvals";
  if (t.startsWith("referral") || t.startsWith("report.referred") || t.startsWith("knowledge.")) return "referrals";
  if (t.startsWith("marketing") || t.startsWith("campaign") || t.startsWith("promo")) return "marketing";
  return "system";
}

/** اعلانِ نتیجه/اطلاع (پذیرفته/رد/لغو/انجام/دیده‌شد…) کاری برای گیرنده نیست — همان قاعده‌ی سرور */
const INFORMATIONAL_SUFFIX = /[._](reviewed|accepted|rejected|declined|cancelled|canceled|completed|done|approved|seen|viewed|read|forwarded_ack|started)$/;
const IMPORTANT_TASK = ["task.assigned", "task.returned", "task.overdue", "task.extension_requested", "task.result_submitted", "task.problem"];

/** مهم = نیازمند اقدام. پرچم سرور مقدم است؛ برای ردیف‌های قدیمی از دسته/نوع استنباط می‌شود. */
export function isImportant(n: Pick<NotifLike, "type" | "category" | "important">): boolean {
  if (typeof n.important === "boolean" && n.important) return true;
  const t = (n.type ?? "").toLowerCase();
  if (t.startsWith("notification.reminder") || t === "system.test") return false;
  const c = categoryOf(n);
  if (c === "referrals" || c === "approvals" || c === "correspondence") return !INFORMATIONAL_SUFFIX.test(t);
  if (c === "tasks") return IMPORTANT_TASK.some((x) => t.startsWith(x));
  if (c === "messenger") return t.includes("mention");
  return false;
}

/** توست چسبنده: مهم‌ها + منشن/پیام مستقیم تا کاربر خودش ببندد. */
export function isSticky(n: Pick<NotifLike, "type" | "category" | "important">): boolean {
  const t = (n.type ?? "").toLowerCase();
  return isImportant(n) || t.includes("mention") || t.includes("direct");
}

/** نشان عددی زنگوله/منو: ۰ → «»، ۹۹+ سقف. */
export function badgeLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? `${toFa(99)}+` : toFa(Math.floor(count));
}

/** پیشوند عنوان تب «(۳) عنوان»؛ پیشوند قبلی را عوض می‌کند و با صفر بودن برمی‌دارد. */
export function tabTitle(title: string, count: number): string {
  const base = (title ?? "").replace(/^\((?:[0-9۰-۹]+\+?)\)\s*/, "");
  const label = badgeLabel(count);
  return label ? `(${label}) ${base}` : base;
}

export function filterItems<T extends NotifLike>(items: T[], filter: "all" | "unread" | "important"): T[] {
  if (filter === "unread") return items.filter((n) => !n.readAt);
  if (filter === "important") return items.filter((n) => !n.readAt && isImportant(n));
  return items;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** گروه‌بندی «امروز / قبل‌تر» (روز تقویمی محلی)؛ گروه خالی حذف می‌شود. ترتیب ورودی حفظ می‌شود. */
export function groupByDay<T extends NotifLike>(items: T[], now: Date = new Date()): { key: "today" | "earlier"; label: string; items: T[] }[] {
  const today = dayKey(now);
  const t: T[] = [];
  const e: T[] = [];
  for (const n of items) (dayKey(new Date(n.createdAt)) === today ? t : e).push(n);
  const out: { key: "today" | "earlier"; label: string; items: T[] }[] = [];
  if (t.length) out.push({ key: "today", label: "امروز", items: t });
  if (e.length) out.push({ key: "earlier", label: "قبل‌تر", items: e });
  return out;
}

/** زمان نسبی کوتاه فارسی: «همین الان»، «۵ دقیقه پیش»، «۲ ساعت پیش»؛ بیش از یک روز → null (فراخواننده تاریخ نشان می‌دهد). */
export function relativeTimeFa(iso: string, now: Date = new Date()): string | null {
  const diff = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return null;
  if (diff < 45_000) return "همین الان";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${toFa(min)} دقیقه پیش`;
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `${toFa(h)} ساعت پیش`;
  return null;
}

/** فقط مسیر درون‌برنامه؛ هرچیز دیگر → صندوق اعلان. */
export function safeHref(link: string | null | undefined): string {
  if (typeof link !== "string" || !link.startsWith("/") || link.startsWith("//") || link.includes("\\")) return "/notifications";
  if (/[\u0000-\u001f\u007f]/.test(link)) return "/notifications";
  return link;
}

// ── ساعات سکوت ───────────────────────────────────────────────────────────────
export function parseHHmm(v: string | null | undefined): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((v ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function tehranMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

export function inQuietHours(nowMin: number, start: string | null | undefined, end: string | null | undefined): boolean {
  const s = parseHHmm(start);
  const e = parseHHmm(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

// ── توست ─────────────────────────────────────────────────────────────────────
export type ToastDecision = { show: boolean; sticky: boolean; sound: boolean };

/** آیا برای این اعلان تازه توست/صدا نشان بدهیم؟ ترجیح‌های کاربر (توست، دسته‌ی درون‌برنامه، سکوت) رعایت می‌شود. */
export function toastDecision(n: NotifLike, prefs: PrefsLike | null, now: Date = new Date()): ToastDecision {
  const none = { show: false, sticky: false, sound: false };
  if (prefs?.toastEnabled === false) return none;
  if (prefs?.categoryPrefs?.[categoryOf(n)]?.inApp === false) return none;
  const critical = (n.type ?? "").toLowerCase().startsWith("reminder.alarm") || (n.type ?? "").toLowerCase().startsWith("security.");
  const quiet = Boolean(prefs?.quietHoursEnabled) && inQuietHours(tehranMinutes(now), prefs?.quietStart, prefs?.quietEnd);
  if (quiet && !critical) return none;
  return { show: true, sticky: isSticky(n), sound: prefs?.soundEnabled !== false };
}

/** اعلان‌های نخوانده‌ی جدید نسبت به آنچه قبلاً دیده شده (قدیمی‌تر از maxAgeMs توست نمی‌شوند: بعد از بازگشت از آفلاین سیل توست نیاید). قدیمی‌ترین اول. */
export function detectArrivals<T extends NotifLike>(items: T[], seen: ReadonlySet<string>, now: Date = new Date(), maxAgeMs = 10 * 60_000): T[] {
  return items
    .filter((n) => !n.readAt && !seen.has(n.id) && now.getTime() - new Date(n.createdAt).getTime() <= maxAgeMs)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export type ToastItem = { id: string; sticky: boolean; at: number };

/**
 * سقف پشته (۳): ابتدا قدیمی‌ترین غیرچسبنده کنار می‌رود، بعد قدیمی‌ترین چسبنده (در زنگوله می‌ماند).
 * `hidden` تعداد توست‌های کنار رفته که هنوز نخوانده‌اند (برای «+N مورد دیگر»).
 */
export function limitStack<T extends ToastItem>(list: T[], max = 3): { visible: T[]; hidden: number } {
  const keep = [...list];
  let hidden = 0;
  while (keep.length > max) {
    let idx = keep.findIndex((t) => !t.sticky);
    if (idx === -1) idx = 0;
    keep.splice(idx, 1);
    hidden++;
  }
  return { visible: keep, hidden };
}

/** مدت نمایش توست غیرچسبنده (ms). */
export const TOAST_AUTO_DISMISS_MS = 7000;

// ── poll ─────────────────────────────────────────────────────────────────────
/**
 * فاصله‌ی poll بعدی: تب دیدنی ۸ثانیه (پس از ۲ دقیقه بی‌تعامل ۱۵، پس از ۱۰ دقیقه ۳۰)، تب پنهان ۶۰ ثانیه؛
 * خطاهای پیاپی نمایی تا سقف ۱۲۰ ثانیه عقب می‌روند.
 */
export function nextPollDelay(o: { visible: boolean; idleMs: number; failures: number }): number {
  let base = o.visible ? (o.idleMs > 10 * 60_000 ? 30_000 : o.idleMs > 2 * 60_000 ? 15_000 : 8_000) : 60_000;
  if (o.failures > 0) base = Math.min(120_000, base * 2 ** Math.min(o.failures, 5));
  return base;
}

// ── توجه شما ─────────────────────────────────────────────────────────────────
export type AttentionGroup = { category: string; label: string; count: number; first: NotifLike };

/** گروه‌بندی اعلان‌های مهم نخوانده به‌تفکیک دسته (ترتیب: بیشترین تعداد، سپس جدیدترین). */
export function summarizeAttention(items: NotifLike[]): AttentionGroup[] {
  const map = new Map<string, AttentionGroup>();
  for (const n of items) {
    if (n.readAt) continue;
    const c = categoryOf(n);
    const g = map.get(c);
    if (g) g.count++;
    else map.set(c, { category: c, label: CATEGORY_LABEL[c] ?? c, count: 1, first: n });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || new Date(b.first.createdAt).getTime() - new Date(a.first.createdAt).getTime());
}

/** نشان تعداد روی آیتم منو: شمارش اعلان‌های نخوانده‌ای که لینکشان با اولین بخش href یکی است. */
export function navBadgeFor(href: string, byLink: Record<string, number> | null | undefined): number {
  if (!byLink) return 0;
  // فقط آیتم‌های تک‌بخشی (/tasks)؛ زیرمنوها (/crm/funnel) نشان والد را تکرار نکنند
  const m = /^(\/[^/?#]+)\/?$/.exec(href);
  return m ? (byLink[m[1]] ?? 0) : 0;
}
