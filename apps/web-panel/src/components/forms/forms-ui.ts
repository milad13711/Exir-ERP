import { toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import type { FormSubmissionStatus } from "@/lib/api";

export const SUBMISSION_STATUS_LABELS: Record<FormSubmissionStatus, string> = { NEW: "جدید", IN_REVIEW: "در حال بررسی", DONE: "انجام‌شده" };
export const SUBMISSION_STATUS_TONES: Record<FormSubmissionStatus, "primary" | "warning" | "success"> = { NEW: "primary", IN_REVIEW: "warning", DONE: "success" };

/** «۵ دقیقه پیش» / «۲ ساعت پیش» / «دیروز» — بعد از یک هفته تاریخ شمسی. */
export function timeAgoFa(iso: string | Date, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "همین الان";
  if (min < 60) return `${toPersianDigits(min)} دقیقه پیش`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${toPersianDigits(hr)} ساعت پیش`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "دیروز";
  if (day < 7) return `${toPersianDigits(day)} روز پیش`;
  return formatJalaliDateTime(new Date(t));
}

export function isHttpUrl(v: string): boolean {
  return /^https?:\/\/\S+$/i.test(v.trim());
}
export function isImageUrl(v: string): boolean {
  return isHttpUrl(v) && /\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(v.trim());
}
