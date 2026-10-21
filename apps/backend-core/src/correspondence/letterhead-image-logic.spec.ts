import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dimensionsAcceptable } from './pdf/image-dimensions.js';

// منطق خالص سربرگ سمت مرورگر (web-panel/src/lib/letterhead-image-logic.ts) — بدون وابستگی؛ از اینجا آزمون می‌شود.
const WEB = resolve(__dirname, '../../../web-panel/src/lib/letterhead-image-logic.ts');
type Cand = { type: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number };
type Logic = {
  fitSize: (w: number, h: number, maxSide?: number) => { width: number; height: number; scale: number };
  pdfRenderScale: (w: number, h: number) => number;
  chooseBest: (c: Cand[], max?: number) => Cand | null;
  dimensionsOk: (w: number, h: number) => boolean;
  pdfErrorMessage: (e: unknown) => string;
  pdfInputError: (f: { size: number; type: string; name: string }) => string | null;
  describeResult: (w: number, h: number, b: number, t: Cand['type']) => string;
  LETTERHEAD_MAX_BYTES: number;
};
const load = async (): Promise<Logic> => (await import(/* @vite-ignore */ pathToFileURL(WEB).href)) as Logic;

describe('letterhead image logic (browser side)', () => {
  it('A4 @300dpi: long side capped at 3508px and never upscaled', async () => {
    const L = await load();
    expect(L.fitSize(4961, 7016)).toMatchObject({ width: 2481, height: 3508 }); // A4@600dpi → ≈300dpi
    expect(L.fitSize(1000, 1400)).toMatchObject({ width: 1000, height: 1400, scale: 1 }); // اسکن کوچک بزرگ نمی‌شود
    expect(L.fitSize(0, 10)).toMatchObject({ width: 0 });
    const f = L.fitSize(9000, 6000);
    expect(Math.max(f.width, f.height)).toBe(3508);
    expect(dimensionsAcceptable({ w: f.width, h: f.height })).toBe(true);
  });
  it('PDF scale = 300dpi, bounded by the 3508px long side', async () => {
    const L = await load();
    const s = L.pdfRenderScale(595.28, 841.89); // A4 در نقطه
    expect(s).toBeCloseTo(300 / 72, 2);
    expect(Math.round(841.89 * s)).toBeLessThanOrEqual(3508);
    expect(L.pdfRenderScale(2000, 3000)).toBeLessThan(300 / 72); // صفحه‌ی بزرگ‌تر: سقف ضلع
    expect(Math.round(3000 * L.pdfRenderScale(2000, 3000))).toBeLessThanOrEqual(3508);
  });
  it('picks the smallest candidate under the cap; ties prefer lossless PNG then WebP', async () => {
    const L = await load();
    const MB = 1024 * 1024;
    expect(L.chooseBest([{ type: 'image/png', bytes: 5 * MB }, { type: 'image/jpeg', bytes: 1.2 * MB }, { type: 'image/webp', bytes: 0.9 * MB }])!.type).toBe('image/webp');
    expect(L.chooseBest([{ type: 'image/png', bytes: 7 * MB }, { type: 'image/jpeg', bytes: 2 * MB }])!.type).toBe('image/jpeg');
    expect(L.chooseBest([{ type: 'image/png', bytes: 7 * MB }, { type: 'image/jpeg', bytes: 8 * MB }])).toBeNull();
    expect(L.chooseBest([{ type: 'image/jpeg', bytes: 1000 }, { type: 'image/png', bytes: 1000 }, { type: 'image/webp', bytes: 1000 }])!.type).toBe('image/png');
    expect(L.chooseBest([{ type: 'image/png', bytes: 0 }])).toBeNull();
  });
  it('client limits mirror the server (25MP, side ≤ 8000, 6MB)', async () => {
    const L = await load();
    for (const [w, h] of [[3508, 2480], [8000, 3125], [8001, 10], [5000, 5001], [0, 5]]) expect(L.dimensionsOk(w, h), `${w}x${h}`).toBe(dimensionsAcceptable({ w, h }));
    expect(L.LETTERHEAD_MAX_BYTES).toBe(6 * 1024 * 1024);
  });
  it('Persian error messages for encrypted / corrupt / huge PDFs', async () => {
    const L = await load();
    expect(L.pdfErrorMessage({ name: 'PasswordException' })).toMatch(/رمزدار/);
    expect(L.pdfErrorMessage({ name: 'InvalidPDFException' })).toMatch(/خراب/);
    expect(L.pdfErrorMessage(new Error('Invalid PDF structure'))).toMatch(/خراب/);
    expect(L.pdfErrorMessage(new Error('Array buffer allocation failed'))).toMatch(/بزرگ/);
    expect(L.pdfErrorMessage(new Error('???'))).toMatch(/ناموفق/);
    expect(L.pdfInputError({ name: 'a.pdf', type: 'application/pdf', size: 40 * 1024 * 1024 })).toMatch(/حجم/);
    expect(L.pdfInputError({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/خالی/);
    expect(L.pdfInputError({ name: 'a.png', type: 'image/png', size: 40 * 1024 * 1024 })).toBeNull();
  });
  it('summary shows format, pixel size, dpi and size', async () => {
    const L = await load();
    expect(L.describeResult(2480, 3508, 2.5 * 1024 * 1024, 'image/jpeg')).toBe('JPEG · 2480×3508 پیکسل (≈300dpi روی A4) · 2.5 MB');
  });
});
