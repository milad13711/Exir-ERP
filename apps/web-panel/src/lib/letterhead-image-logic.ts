/**
 * منطق خالص تهیه‌ی تصویر سربرگ (بدون DOM و بدون import) — جدا از لایه‌ی canvas تا تست‌پذیر باشد.
 * A4 در ۳۰۰dpi = ۲۴۸۰×۳۵۰۸ پیکسل؛ سقف بایت سرور ۶ مگابایت و ابعاد ≤ ۲۵ مگاپیکسل (ضلع ≤ ۸۰۰۰).
 */
export const LETTERHEAD_MAX_BYTES = 6 * 1024 * 1024;
export const LETTERHEAD_MAX_SIDE = 3508;
export const SERVER_MAX_PIXELS = 25_000_000;
export const SERVER_MAX_SIDE = 8000;
export const PDF_TARGET_DPI = 300;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export type Candidate = { type: ImageMime; bytes: number; quality?: number };

/** ابعاد نهایی: بزرگ‌ترین ضلع حداکثر maxSide؛ هرگز بزرگ‌نمایی نمی‌شود (اسکن کوچک الکی ریز نمی‌شود). */
export function fitSize(w: number, h: number, maxSide = LETTERHEAD_MAX_SIDE): { width: number; height: number; scale: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/** مقیاس رندر PDF (واحد صفحه = نقطه، ۷۲ در اینچ) برای ۳۰۰dpi، با سقف ضلع ۳۵۰۸ پیکسل. */
export function pdfRenderScale(widthPt: number, heightPt: number, dpi = PDF_TARGET_DPI, maxSide = LETTERHEAD_MAX_SIDE): number {
  if (!(widthPt > 0) || !(heightPt > 0)) return 1;
  return Math.min(dpi / 72, maxSide / Math.max(widthPt, heightPt));
}

/** کوچک‌ترین نامزد زیر سقف؛ برابری بایت → اولویت PNG (بی‌اتلاف) سپس WebP سپس JPEG. null = هیچ‌کدام زیر سقف نیست. */
export function chooseBest(cands: Candidate[], maxBytes = LETTERHEAD_MAX_BYTES): Candidate | null {
  const rank: Record<ImageMime, number> = { "image/png": 0, "image/webp": 1, "image/jpeg": 2 };
  const ok = cands.filter((c) => c.bytes > 0 && c.bytes <= maxBytes);
  ok.sort((a, b) => a.bytes - b.bytes || rank[a.type] - rank[b.type]);
  return ok[0] ?? null;
}

/** ابعاد قابل‌قبول سرور (۲۵ مگاپیکسل و ضلع ≤ ۸۰۰۰). */
export function dimensionsOk(w: number, h: number): boolean {
  return w > 0 && h > 0 && w <= SERVER_MAX_SIDE && h <= SERVER_MAX_SIDE && w * h <= SERVER_MAX_PIXELS;
}

export function describeResult(width: number, height: number, bytes: number, type: ImageMime): string {
  const kb = bytes / 1024;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  const fmt = type === "image/png" ? "PNG" : type === "image/jpeg" ? "JPEG" : "WebP";
  const dpi = Math.round(width / (210 / 25.4));
  return `${fmt} · ${width}×${height} پیکسل (≈${dpi}dpi روی A4) · ${size}`;
}

/** پیام فارسی برای خطاهای pdf.js (بر اساس name/message؛ بدون وابستگی به کلاس‌های کتابخانه). */
export function pdfErrorMessage(e: unknown): string {
  const name = typeof e === "object" && e && "name" in e ? String((e as { name: unknown }).name) : "";
  const msg = e instanceof Error ? e.message : "";
  if (name === "PasswordException" || /password/i.test(msg)) return "این PDF رمزدار است. نسخه‌ی بدون رمز را بارگذاری کنید.";
  if (name === "InvalidPDFException" || /invalid pdf|corrupt|xref|unexpected/i.test(msg)) return "فایل PDF خراب یا نامعتبر است.";
  if (name === "MissingPDFException") return "فایل PDF پیدا نشد.";
  if (/memory|too large|allocation|canvas/i.test(msg)) return "صفحه‌ی PDF برای رندر در مرورگر بیش از حد بزرگ است. نسخه‌ی کم‌حجم‌تر یا تصویر آن را بارگذاری کنید.";
  return "خواندن PDF ناموفق بود. فایل دیگری را امتحان کنید یا صفحه را به تصویر تبدیل کنید.";
}

export const PDF_MAX_BYTES = 30 * 1024 * 1024;
export function pdfInputError(file: { size: number; type: string; name: string }): string | null {
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return null;
  if (file.size > PDF_MAX_BYTES) return `حجم PDF زیاد است (حداکثر ${PDF_MAX_BYTES / 1024 / 1024} مگابایت).`;
  if (file.size === 0) return "فایل PDF خالی است.";
  return null;
}
