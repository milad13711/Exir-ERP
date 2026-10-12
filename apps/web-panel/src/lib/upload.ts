/**
 * کمکی مشترک بارگذاری: فایل → (کاهش حجم/بررسی سقف از media.ts) → data-URI.
 * همه‌ی نقاط ورود فایل باید به‌جای FileReader مستقیم از این استفاده کنند.
 */
import { compressImage, prepareUpload, UploadRejectedError } from "./media";

export { UploadRejectedError };

/** فایل را آماده می‌کند و به data-URI تبدیل می‌کند. `UploadRejectedError` پیام فارسی قابل‌نمایش دارد. */
export async function fileToDataUri(
  file: File,
  kind?: "image" | "file" | "video",
  opts?: { maxDimension?: number; quality?: number; targetBytes?: number },
): Promise<string> {
  const k = kind ?? (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file");
  const prepared = k === "image" && opts ? await compressImage(file, opts) : await prepareUpload(file, k);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("خواندن فایل ناموفق بود"));
    reader.readAsDataURL(prepared);
  });
}

/** آواتار/لوگو/مهر: ضلع کوچک‌تر. */
export const SMALL_IMAGE = { maxDimension: 800, targetBytes: 300 * 1024 } as const;
export const AVATAR_IMAGE = { maxDimension: 512, targetBytes: 200 * 1024 } as const;

/** پیام قابل‌نمایش از هر خطای بارگذاری. */
export function uploadErrorMessage(e: unknown, fallback = "بارگذاری فایل ناموفق بود"): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export const IMAGE_COMPRESS_HINT = "تصاویر به‌صورت خودکار کم‌حجم می‌شوند";
