import type { ReactNode } from "react";
import { toPersianDigits } from "@/lib/persian";
import type { ChatMessage, ConversationDetail, ConversationSummary, MessengerMedia, MessengerMessage } from "@/lib/messenger-api";

export const MEDIA_WARNING = "فایل‌ها و تصاویر ارسالی فقط ۲۴ ساعت نگهداری و سپس حذف می‌شوند؛ برای نگهداری دائم آن را روی دستگاه خود دانلود کنید.";

export const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🔥", "👏", "🎉", "👎"];

export function clockFa(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "امروز";
  if (dayKey(iso) === dayKey(y.toISOString())) return "دیروز";
  return d.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
}

export function lastSeenLabel(online: boolean, lastSeenAt: string | null): string {
  if (online) return "آنلاین";
  if (!lastSeenAt) return "";
  const mins = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
  if (mins < 1) return "لحظاتی پیش";
  if (mins < 60) return `${toPersianDigits(mins)} دقیقه پیش`;
  if (mins < 24 * 60) return `${toPersianDigits(Math.floor(mins / 60))} ساعت پیش`;
  return `آخرین بازدید ${new Date(lastSeenAt).toLocaleDateString("fa-IR")}`;
}

/** پیش‌نمایش یک پیام برای فهرست گفتگوها. */
export function previewOf(m: MessengerMessage | null): string {
  if (!m) return "";
  if (m.deleted) return "این پیام حذف شد";
  if (m.kind === "SYSTEM") return m.text ?? "";
  if (m.media) return `${mediaLabel(m.media)}${m.text ? ` ${m.text}` : m.media.kind === "FILE" && !isAudio(m.media) ? ` ${m.media.fileName}` : ""}`;
  return m.text ?? "";
}

export function isAudio(media: Pick<MessengerMedia, "mime">): boolean {
  return media.mime.startsWith("audio/");
}

/** «📷 تصویر / 🎞 ویدئو / 🎤 پیام صوتی / 📎 فایل». */
export function mediaLabel(media: Pick<MessengerMedia, "kind" | "mime">): string {
  if (isAudio(media)) return "🎤 پیام صوتی";
  return media.kind === "IMAGE" ? "📷 تصویر" : media.kind === "VIDEO" ? "🎞 ویدئو" : "📎 فایل";
}

/** مدت پیام صوتی از نام فایل (voice-<ثانیه>.webm)؛ MediaRecorder فرادده‌ی مدت نمی‌نویسد. */
export function voiceSecondsFromName(fileName: string): number | null {
  const m = /^voice-(\d+)\./.exec(fileName);
  return m ? Number(m[1]) : null;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return toPersianDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
}

/** سنجاق‌شده‌ها بالا (به ترتیب سنجاق شدن)، سپس آخرین فعالیت. */
export function sortConvs(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort((a, b) => {
    if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt && b.pinnedAt && a.pinnedAt !== b.pinnedAt) return a.pinnedAt.localeCompare(b.pinnedAt);
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
}

// ── پیش‌نویس هر گفتگو (به‌ازای هر کاربر) ──────────────────────────────
const draftKey = (userId: string, convId: string) => `exir-messenger-draft:${userId}:${convId}`;
export function loadDraft(userId: string, convId: string): string {
  try {
    return localStorage.getItem(draftKey(userId, convId)) ?? "";
  } catch {
    return "";
  }
}
export function saveDraft(userId: string, convId: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(draftKey(userId, convId), text);
    else localStorage.removeItem(draftKey(userId, convId));
  } catch {
    /* بی‌اهمیت */
  }
}
export function loadAllDrafts(userId: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const prefix = `exir-messenger-draft:${userId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) out[k.slice(prefix.length)] = localStorage.getItem(k) ?? "";
    }
  } catch {
    /* بی‌اهمیت */
  }
  return out;
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/**
 * متن پیام همیشه به‌صورت «متن» رندر می‌شود (React خودش escape می‌کند، هیچ HTML خامی تزریق نمی‌شود)؛
 * فقط نشانی‌های http/https به لینک امن تبدیل می‌شوند.
 */
export function renderText(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="underline break-all" dir="ltr">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export type Ticks = "none" | "pending" | "failed" | "sent" | "delivered" | "seen";

/** وضعیت ارسال پیام خودم: مستقیم = طرف مقابل؛ گروه = «همه‌ی دیگران». */
export function ticksFor(m: ChatMessage, detail: ConversationDetail | null, myId: string): Ticks {
  if (m.local) return m.local;
  if (!detail || m.senderId !== myId || detail.type === "SAVED" || m.kind === "SYSTEM") return "none";
  const others = detail.members.filter((x) => x.userId !== myId);
  if (others.length === 0) return "sent";
  if (others.every((o) => o.lastReadSeq >= m.seq)) return "seen";
  if (others.every((o) => o.lastDeliveredSeq >= m.seq)) return "delivered";
  return "sent";
}

export function Avatar({ name, size = 40, tone = "primary" }: { name: string; size?: number; tone?: "primary" | "saved" }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("‌");
  return (
    <div
      className={`rounded-full shrink-0 flex items-center justify-center font-bold ${tone === "saved" ? "bg-accent text-white" : "bg-primary-soft text-primary"}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {tone === "saved" ? "🔖" : initials || "؟"}
    </div>
  );
}
