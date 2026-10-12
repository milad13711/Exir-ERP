import type { ReactNode } from "react";
import { toPersianDigits } from "@/lib/persian";
import type { ConversationDetail, MessengerMessage } from "@/lib/messenger-api";

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
  if (m.media) return `${m.media.kind === "IMAGE" ? "🖼" : m.media.kind === "VIDEO" ? "🎞" : "📎"} ${m.text || m.media.fileName}`;
  return m.text ?? "";
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

export type Ticks = "none" | "sent" | "delivered" | "seen";

/** وضعیت ارسال پیام خودم: مستقیم = طرف مقابل؛ گروه = «همه‌ی دیگران». */
export function ticksFor(m: MessengerMessage, detail: ConversationDetail | null, myId: string): Ticks {
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
