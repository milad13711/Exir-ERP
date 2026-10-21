import {
  LETTERHEAD_MAX_BYTES, LETTERHEAD_MAX_SIDE, chooseBest, dimensionsOk, describeResult, fitSize, pdfErrorMessage, pdfInputError, pdfRenderScale,
  type Candidate, type ImageMime,
} from "./letterhead-image-logic";
import { UploadRejectedError } from "./media";

/**
 * تهیه‌ی تصویر سربرگ با کیفیت چاپ — جدا از prepareUpload عمومی (که ضلع ۱۶۰۰px و کیفیت ۰٫۸ دارد و سربرگ را بی‌کیفیت می‌کرد).
 *  - تصویر: تا ۳۵۰۸ پیکسل (A4 در ۳۰۰dpi)، هرگز بزرگ‌نمایی نمی‌شود؛ کوچک‌ترین بین PNG/JPEG(۰٫۹۴)/WebP(۰٫۹۴) زیر سقف ۶ مگابایت.
 *  - PDF: صفحه‌ی انتخابی با pdf.js (بارگذاری تنبل، worker از bundle) روی canvas با ۳۰۰dpi رندر و به همان مسیر تصویر می‌رود.
 *    تجزیه‌ی PDF غیرقابل‌اعتماد فقط در مرورگر کاربر انجام می‌شود؛ سرور هرگز PDF نمی‌پذیرد.
 */
export type LetterheadImage = { dataUri: string; width: number; height: number; bytes: number; type: ImageMime; summary: string };

type Cnv = HTMLCanvasElement;
const newCanvas = (w: number, h: number): Cnv => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const toBlob = (c: Cnv, type: ImageMime, q?: number) => new Promise<Blob | null>((r) => c.toBlob((b) => r(b), type, q));

function blobToDataUri(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new UploadRejectedError("خواندن تصویر ناموفق بود"));
    fr.readAsDataURL(b);
  });
}

/** canvas → بهترین فرمت زیر سقف؛ اگر نشد، ابعاد را کم‌کم کوچک می‌کند (تا حداقل ۱۲۰۰px) و کیفیت را پایین می‌آورد. */
async function encodeBest(src: Cnv): Promise<LetterheadImage> {
  let canvas = src;
  for (let attempt = 0; attempt < 6; attempt++) {
    const quality = attempt < 3 ? 0.94 : 0.88;
    const blobs: { blob: Blob; cand: Candidate }[] = [];
    for (const type of ["image/png", "image/jpeg", "image/webp"] as const) {
      const blob = await toBlob(canvas, type, type === "image/png" ? undefined : quality);
      if (blob && blob.type === type) blobs.push({ blob, cand: { type, bytes: blob.size } });
    }
    const best = chooseBest(blobs.map((b) => b.cand), LETTERHEAD_MAX_BYTES);
    if (best) {
      const blob = blobs.find((b) => b.cand === best)!.blob;
      if (!dimensionsOk(canvas.width, canvas.height)) throw new UploadRejectedError("ابعاد تصویر برای سربرگ بیش از حد بزرگ است.");
      return { dataUri: await blobToDataUri(blob), width: canvas.width, height: canvas.height, bytes: blob.size, type: best.type, summary: describeResult(canvas.width, canvas.height, blob.size, best.type) };
    }
    if (Math.max(canvas.width, canvas.height) <= 1200) break;
    const next = newCanvas(Math.round(canvas.width * 0.85), Math.round(canvas.height * 0.85));
    const ctx = next.getContext("2d");
    if (!ctx) break;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  throw new UploadRejectedError("حجم تصویر سربرگ حتی پس از فشرده‌سازی از ۶ مگابایت بیشتر است. تصویر ساده‌تر یا کم‌رنگ‌تری بارگذاری کنید.");
}

export async function prepareLetterheadFromImage(file: File): Promise<LetterheadImage> {
  if (!/^image\/(png|jpeg|webp|bmp|heic|heif|avif)$/i.test(file.type)) throw new UploadRejectedError("فقط تصویر (PNG، JPEG، WebP) یا PDF پذیرفته می‌شود.");
  if (file.size > 60 * 1024 * 1024) throw new UploadRejectedError("حجم فایل زیاد است (حداکثر ۶۰ مگابایت پیش از فشرده‌سازی).");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    throw new UploadRejectedError("تصویر خوانده نشد؛ فایل خراب یا فرمت ناشناخته است.");
  }
  try {
    const { width, height } = fitSize(bmp.width, bmp.height, LETTERHEAD_MAX_SIDE);
    const c = newCanvas(width, height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new UploadRejectedError("مرورگر شما از canvas پشتیبانی نمی‌کند.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, width, height);
    return await encodeBest(c);
  } finally {
    bmp.close();
  }
}

// ───── PDF (فقط در مرورگر) ─────
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: Cnv }) => { promise: Promise<void> };
  cleanup: () => void;
};

async function loadPdf(file: File): Promise<PdfDoc> {
  const err = pdfInputError(file);
  if (err) throw new UploadRejectedError(err);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // worker از bundle (هم‌مبدأ؛ بدون CDN)
  if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  }
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    // pdf.js نسخه‌ی ۶ eval ندارد و اسکریپت PDF اجرا نمی‌کند؛ parse فقط در worker مرورگر
    const task = pdfjs.getDocument({ data });
    return (await task.promise) as unknown as PdfDoc;
  } catch (e) {
    throw new UploadRejectedError(pdfErrorMessage(e));
  }
}

export async function pdfPageCount(file: File): Promise<number> {
  const doc = await loadPdf(file);
  try {
    return doc.numPages;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

export async function prepareLetterheadFromPdf(file: File, pageNo = 1): Promise<LetterheadImage> {
  const doc = await loadPdf(file);
  try {
    if (pageNo < 1 || pageNo > doc.numPages) throw new UploadRejectedError("شماره‌ی صفحه‌ی PDF نامعتبر است.");
    const page = await doc.getPage(pageNo);
    try {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pdfRenderScale(base.width, base.height) });
      const w = Math.max(1, Math.round(viewport.width));
      const h = Math.max(1, Math.round(viewport.height));
      if (!dimensionsOk(w, h)) throw new UploadRejectedError("صفحه‌ی PDF بیش از حد بزرگ است.");
      const c = newCanvas(w, h);
      const ctx = c.getContext("2d");
      if (!ctx) throw new UploadRejectedError("مرورگر شما از canvas پشتیبانی نمی‌کند.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, viewport, canvas: c }).promise;
      return await encodeBest(c);
    } catch (e) {
      if (e instanceof UploadRejectedError) throw e;
      throw new UploadRejectedError(pdfErrorMessage(e));
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
