import { BadRequestException } from '@nestjs/common';

export const CHECKLIST_ITEM_ENTITY = 'DailyChecklistItem';

/** سقف مجموع حجم فایل‌های بایگانی‌شده در یک گزارش روزانه (نویسه‌های data URI، حدود ۳۳ مگابایت خام). */
export const MAX_REPORT_ARCHIVE_CHARS = 45_000_000;

const FILENAME_LIKE = /\.[A-Za-z0-9]{1,6}$/;

/**
 * هر فایلِ پیوست‌شده به آیتم چک‌لیست باید یک «نام» انسانیِ انتخاب‌شده‌ی کاربر داشته باشد
 * (نه صرفاً نام فایل مثل IMG_2031.jpg) تا فایل‌ها هیچ‌وقت مبهم نباشند. نام تمیز و برگردانده می‌شود.
 * existingTitles = نام فایل‌های دیگرِ همان آیتم (برای جلوگیری از تکراری‌بودن).
 */
export function normalizeChecklistAttachmentTitle(raw: unknown, existingTitles: string[] = []): string {
  const title = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (title.length < 2) throw new BadRequestException('برای هر فایل باید یک نام (حداقل ۲ نویسه) انتخاب کنید');
  if (title.length > 120) throw new BadRequestException('نام فایل حداکثر ۱۲۰ نویسه می‌تواند باشد');
  if (FILENAME_LIKE.test(title)) {
    throw new BadRequestException('به‌جای نام فایل (مثلاً scan.pdf) یک نام گویا انتخاب کنید؛ پسوند فایل لازم نیست');
  }
  const lower = title.toLocaleLowerCase();
  if (existingTitles.some((t) => t.trim().toLocaleLowerCase() === lower)) {
    throw new BadRequestException('فایل دیگری با همین نام روی این مورد هست؛ نام متفاوتی انتخاب کنید');
  }
  return title;
}
