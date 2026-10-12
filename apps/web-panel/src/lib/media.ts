/**
 * ابزار مشترک کاهش حجم رسانه هنگام بارگذاری (قبل از ارسال به سرور) — برای همه‌ی بخش‌های برنامه.
 *
 * چرا: فایل‌ها به‌صورت data-URI داخل Postgres ذخیره می‌شوند؛ عکس ۴–۸ مگابایتی موبایل دیتابیس و پشتیبان را سنگین می‌کند.
 * عکس‌ها سمت مرورگر کوچک و فشرده می‌شوند (حداکثر ضلع ۱۶۰۰ پیکسل، کیفیت ۰٫۸، هدف ≤ ۱٫۵ مگابایت)؛ بقیه‌ی فایل‌ها و ویدئو
 * فقط محدودیت حجم می‌گیرند (فشرده‌سازی ویدئو سمت مرورگر مطمئن نیست؛ برای پیام‌رسان سمت سرور انجام می‌شود).
 *
 * تنها نقطه‌ی ورود پیشنهادی: `prepareUpload(file, "image" | "file" | "video")` → فایل آماده‌ی ارسال یا خطای فارسی.
 */

export const UPLOAD_LIMITS = {
  /** بزرگ‌ترین ضلع تصویر پس از کاهش (پیکسل). */
  imageMaxDimension: 1600,
  /** کیفیت JPEG/WebP (۰ تا ۱). */
  imageQuality: 0.8,
  /** هدف حجم تصویر پس از فشرده‌سازی. کیفیت تا ۰٫۵ پایین می‌آید تا به این عدد برسد. */
  imageTargetBytes: 1.5 * 1024 * 1024,
  /** سقف حجم تصویر ورودی پیش از فشرده‌سازی (جلوگیری از کرش مرورگر). */
  imageMaxInputBytes: 40 * 1024 * 1024,
  /** سقف فایل غیرتصویری (سند، PDF، …). */
  fileMaxBytes: 10 * 1024 * 1024,
  /** سقف ویدئو. */
  videoMaxBytes: 50 * 1024 * 1024,
} as const;

export class UploadRejectedError extends Error {}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/bmp"]);

function extFor(type: string): string {
  return type === "image/webp" ? "webp" : "jpg";
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), type, quality));
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fallthrough to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    // revoke after the draw in compressImage (the bitmap is already decoded by then)
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * عکس را کوچک و فشرده می‌کند. GIF/SVG و هر چیزِ غیرِ عکس دست‌نخورده برمی‌گردد. اگر نتیجه از اصل بزرگ‌تر شد، اصل برمی‌گردد.
 * WebP فقط وقتی مرورگر واقعاً بتواند آن را بسازد استفاده می‌شود؛ وگرنه JPEG (Safari/iOS).
 */
export async function compressImage(
  file: File,
  opts: { maxDimension?: number; quality?: number; targetBytes?: number } = {},
): Promise<File> {
  if (typeof document === "undefined" || !COMPRESSIBLE.has(file.type)) return file;
  if (file.size > UPLOAD_LIMITS.imageMaxInputBytes) {
    throw new UploadRejectedError(`حجم تصویر زیاد است (${formatBytes(file.size)}). حداکثر ${formatBytes(UPLOAD_LIMITS.imageMaxInputBytes)}.`);
  }
  const maxDim = opts.maxDimension ?? UPLOAD_LIMITS.imageMaxDimension;
  const target = opts.targetBytes ?? UPLOAD_LIMITS.imageTargetBytes;
  let quality = opts.quality ?? UPLOAD_LIMITS.imageQuality;

  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    return file; // فرمت ناشناخته برای مرورگر (مثلاً HEIC روی مرورگر بدون پشتیبانی): بدون تغییر، فقط سقف حجم اعمال می‌شود
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return file;
    // پس‌زمینه‌ی سفید برای PNGهای شفاف (JPEG شفافیت ندارد)
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(decoded.source, 0, 0, w, h);

    let outType = "image/webp";
    let blob = await canvasToBlob(canvas, outType, quality);
    if (!blob || blob.type !== "image/webp") {
      outType = "image/jpeg";
      blob = await canvasToBlob(canvas, outType, quality);
    }
    if (!blob) return file;
    while (blob.size > target && quality > 0.5) {
      quality = Math.max(0.5, quality - 0.1);
      const next = await canvasToBlob(canvas, outType, quality);
      if (!next) break;
      blob = next;
    }
    if (blob.size >= file.size && scale === 1) return file; // فشرده‌سازی کمکی نکرد
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.${extFor(outType)}`, { type: outType, lastModified: Date.now() });
  } finally {
    decoded.close?.();
  }
}

/**
 * آماده‌سازی استاندارد هر فایلِ انتخاب‌شده برای ارسال: عکس → فشرده؛ ویدئو/فایل → فقط بررسی سقف حجم.
 * `kind` اگر داده نشود از نوع MIME حدس زده می‌شود. خطا = `UploadRejectedError` با پیام فارسی قابل‌نمایش.
 */
export async function prepareUpload(file: File, kind?: "image" | "file" | "video"): Promise<File> {
  const k = kind ?? (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file");
  if (k === "image") return compressImage(file);
  const max = k === "video" ? UPLOAD_LIMITS.videoMaxBytes : UPLOAD_LIMITS.fileMaxBytes;
  if (file.size > max) {
    throw new UploadRejectedError(`حجم ${k === "video" ? "ویدئو" : "فایل"} زیاد است (${formatBytes(file.size)}). حداکثر ${formatBytes(max)}.`);
  }
  return file;
}
