import { prepareUpload, UploadRejectedError } from "@/lib/media";
import type { TaskFileInput, TaskPriority, TaskStatus } from "@/lib/api";
import type { Tone } from "@/components/ui/Badge";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "جدید",
  NEW: "جدید",
  SEEN: "دیده‌شده",
  IN_PROGRESS: "در حال انجام",
  DONE: "انجام‌شده (منتظر تأیید)",
  APPROVED: "تأیید‌شده",
  HAS_PROBLEM: "دارای مشکل",
  RETURNED_FOR_FIX: "برگشت برای اصلاح",
  EXPIRED: "منقضی‌شده",
  CANCELLED: "لغوشده",
};

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  OPEN: "primary",
  NEW: "primary",
  SEEN: "accent",
  IN_PROGRESS: "accent",
  DONE: "warning",
  APPROVED: "success",
  HAS_PROBLEM: "danger",
  RETURNED_FOR_FIX: "warning",
  EXPIRED: "danger",
  CANCELLED: "neutral",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = { NORMAL: "عادی", MEDIUM: "مهم", URGENT: "فوری" };
export const PRIORITY_TONE: Record<TaskPriority, Tone> = { NORMAL: "neutral", MEDIUM: "warning", URGENT: "danger" };

/** وظیفه‌ی تمام‌شده (انجام‌شده یا تأییدشده) — برای تیک و خط‌خوردن در لیست‌های خلاصه. */
export const isTaskFinished = (s: TaskStatus) => s === "DONE" || s === "APPROVED";

export const REMINDER_OPTIONS: Array<{ min: number; label: string }> = [
  { min: 15, label: "۱۵ دقیقه قبل" },
  { min: 30, label: "۳۰ دقیقه قبل" },
  { min: 60, label: "۱ ساعت قبل" },
  { min: 180, label: "۳ ساعت قبل" },
  { min: 1440, label: "۱ روز قبل" },
  { min: 2880, label: "۲ روز قبل" },
];

export const RECURRENCE_LABEL = { NONE: "بدون تکرار", DAILY: "روزانه", WEEKLY: "هفتگی", MONTHLY: "ماهانه" } as const;

export const EVENT_LABEL: Record<string, string> = {
  created: "وظیفه ایجاد شد",
  scheduled: "ارسال زمان‌بندی شد",
  sent: "برای ارجاع‌گیرنده ارسال شد",
  viewed: "مشاهده شد",
  started: "شروع شد",
  result_submitted: "نتیجه ثبت شد",
  approved: "تأیید شد",
  auto_approved: "تأیید خودکار",
  returned: "برای اصلاح برگشت خورد",
  problem_reported: "مشکل گزارش شد",
  problem_resolved: "مشکل بررسی شد",
  extension_requested: "درخواست تمدید ثبت شد",
  extension_approved: "تمدید تأیید شد",
  extension_rejected: "تمدید رد شد",
  deadline_changed: "موعد تغییر کرد",
  edited: "ویرایش شد",
  reassigned: "ارجاع مجدد شد",
  cancelled: "لغو شد",
  reopened: "بازگشایی شد",
  resumed: "از انقضا خارج شد",
  expired: "منقضی شد",
  overdue_notified: "اعلان تأخیر ارسال شد",
  reminder_sent: "یادآوری ارسال شد",
  recurred: "نمونه‌ی بعدی ساخته شد",
};

export const FIELD = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary";
export const LABEL = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

/** ISO → "YYYY-MM-DDTHH:mm" محلی (قالب JalaliDateTimeInput). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("خواندن فایل ناموفق بود"));
    r.readAsDataURL(file);
  });
}

/** فایل‌های انتخاب‌شده را با کاهش حجم/بررسی سقف (media.ts) به data-URI تبدیل می‌کند. خطای قابل‌نمایش: UploadRejectedError. */
export async function filesToInputs(files: File[]): Promise<TaskFileInput[]> {
  const out: TaskFileInput[] = [];
  for (const f of files) {
    const prepared = await prepareUpload(f);
    out.push({ title: prepared.name, fileUrl: await readAsDataUrl(prepared) });
  }
  return out;
}

export function uploadErrorText(e: unknown, fallback: string): string {
  if (e instanceof UploadRejectedError) return e.message;
  return e instanceof Error && e.message ? e.message : fallback;
}
