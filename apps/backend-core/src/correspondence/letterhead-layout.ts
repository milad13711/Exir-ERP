import { BadRequestException } from '@nestjs/common';
import { existsSync, readdirSync } from 'node:fs';
import { join, parse } from 'node:path';
import type { LetterBoxKey, LetterBoxLayout, LetterheadLayout } from './render-input.js';

/**
 * واحدها: همه‌ی مختصات بر حسب میلی‌متر، مبدأ = گوشه‌ی بالا-چپ برگه (x به راست، y به پایین)، حتی در نامه‌ی RTL.
 * (جعبه با xMm از لبه‌ی چپ تا xMm+wMm؛ ترازِ متن داخل جعبه با align تعیین می‌شود.)
 */
export const BOX_KEYS: readonly LetterBoxKey[] = ['number', 'date', 'attachments', 'subject', 'recipient', 'body', 'signature', 'paraphs', 'qr', 'confidentiality'];

export const PAGE_MM = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } } as const;

export function pageDims(pageSize: 'A4' | 'A5', orientation: 'portrait' | 'landscape'): { w: number; h: number } {
  const p = PAGE_MM[pageSize];
  return orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/** فونت‌های داخلی. Vazirmatn همراه برنامه است؛ Tahoma/Arial/Times فقط در صورت نصب‌بودن روی سیستم Chromium. */
export const BUILTIN_FONTS = ['Vazirmatn', 'Tahoma', 'Arial', 'Times New Roman'] as const;

let extraFontCache: { dir: string; fonts: Map<string, string> } | null = null;

/**
 * فونت‌های ایرانی اضافه (مثلاً B Nazanin، B Titr، IRANSans) — فقط اگر مستأجر مجوز دارد:
 * فایل‌های woff2/ttf/otf را در پوشه‌ی LETTER_FONTS_DIR بگذارید؛ نام فایل (بدون پسوند) = نام فونت (مثلاً `BNazanin.woff2`).
 * این‌ها خودکار در فهرست مجاز و در PDF جاسازی می‌شوند.
 */
export function extraFontFiles(): Map<string, string> {
  const dir = process.env.LETTER_FONTS_DIR ?? '';
  if (extraFontCache && extraFontCache.dir === dir) return extraFontCache.fonts;
  const fonts = new Map<string, string>();
  if (dir && existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const p = parse(f);
      if (/^\.(woff2|woff|ttf|otf)$/i.test(p.ext) && /^[A-Za-z0-9 _-]{1,40}$/.test(p.name)) fonts.set(p.name, join(dir, f));
    }
  }
  extraFontCache = { dir, fonts };
  return fonts;
}

export function allowedFontFamilies(): string[] {
  return [...BUILTIN_FONTS, ...extraFontFiles().keys()];
}

const ALIGNS = ['right', 'center', 'left', 'justify'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

function fail(msg: string): never {
  throw new BadRequestException(msg);
}
const LABELS: Record<LetterBoxKey, string> = {
  number: 'شماره', date: 'تاریخ', attachments: 'پیوست', subject: 'موضوع', recipient: 'گیرنده', body: 'متن نامه',
  signature: 'امضا', paraphs: 'پاراف', qr: 'کد QR', confidentiality: 'محرمانگی',
};

function num(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${label}: مقدار عددی معتبر نیست`);
  if (v < min || v > max) fail(`${label}: باید بین ${min} و ${max} باشد`);
  return Math.round(v * 100) / 100;
}

/** اعتبارسنجی سخت‌گیرانه؛ خروجی یک شیء تازه (فقط کلیدهای شناخته‌شده) است. */
export function validateLayout(raw: unknown, pageSize: 'A4' | 'A5', orientation: 'portrait' | 'landscape'): LetterheadLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('چیدمان سربرگ نامعتبر است');
  const r = raw as Record<string, unknown>;
  const dims = pageDims(pageSize, orientation);
  const fonts = allowedFontFamilies();

  if (r.pageSize !== undefined && r.pageSize !== pageSize) fail('اندازه‌ی صفحه در چیدمان با اندازه‌ی انتخابی هم‌خوان نیست');
  if (r.orientation !== undefined && r.orientation !== orientation) fail('جهت صفحه در چیدمان با جهت انتخابی هم‌خوان نیست');
  if (typeof r.letterheadOnAllPages !== 'boolean') fail('گزینه‌ی «سربرگ روی همه‌ی صفحات» باید درست/نادرست باشد');
  for (const k of Object.keys(r)) {
    if (!['pageSize', 'orientation', 'letterheadOnAllPages', 'boxes', 'continuationMarginsMm'].includes(k)) fail(`کلید ناشناخته در چیدمان: ${k}`);
  }

  const rawBoxes = r.boxes;
  if (!rawBoxes || typeof rawBoxes !== 'object' || Array.isArray(rawBoxes)) fail('جعبه‌های چیدمان تعریف نشده‌اند');
  const bx = rawBoxes as Record<string, unknown>;
  for (const k of Object.keys(bx)) if (!(BOX_KEYS as readonly string[]).includes(k)) fail(`جعبه‌ی ناشناخته: ${k}`);

  const boxes = {} as Record<LetterBoxKey, LetterBoxLayout>;
  for (const key of BOX_KEYS) {
    const b = bx[key];
    const L = LABELS[key];
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail(`جعبه‌ی «${L}» تعریف نشده است`);
    const o = b as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (!['visible', 'xMm', 'yMm', 'wMm', 'hMm', 'fontFamily', 'fontSizePt', 'bold', 'color', 'align', 'lineHeight'].includes(k)) fail(`«${L}»: ویژگی ناشناخته ${k}`);
    }
    if (typeof o.visible !== 'boolean') fail(`«${L}»: نمایش باید درست/نادرست باشد`);
    if (typeof o.bold !== 'boolean') fail(`«${L}»: ضخیم‌بودن باید درست/نادرست باشد`);
    const x = num(o.xMm, `«${L}» x`, 0, dims.w);
    const y = num(o.yMm, `«${L}» y`, 0, dims.h);
    const w = num(o.wMm, `«${L}» عرض`, 5, dims.w);
    const h = num(o.hMm, `«${L}» ارتفاع`, 3, dims.h);
    if (x + w > dims.w + 0.01) fail(`«${L}»: جعبه از لبه‌ی راست برگه بیرون می‌زند`);
    if (y + h > dims.h + 0.01) fail(`«${L}»: جعبه از لبه‌ی پایین برگه بیرون می‌زند`);
    if (typeof o.fontFamily !== 'string' || !fonts.includes(o.fontFamily)) fail(`«${L}»: فونت مجاز نیست (مجاز: ${fonts.join('، ')})`);
    const fs = num(o.fontSizePt, `«${L}» اندازه‌ی فونت`, 6, 72);
    if (typeof o.color !== 'string' || !HEX.test(o.color)) fail(`«${L}»: رنگ باید به شکل #RRGGBB باشد`);
    if (typeof o.align !== 'string' || !(ALIGNS as readonly string[]).includes(o.align)) fail(`«${L}»: تراز نامعتبر است`);
    const lh = num(o.lineHeight, `«${L}» فاصله‌ی خطوط`, 0.8, 3);
    boxes[key] = {
      visible: o.visible, xMm: x, yMm: y, wMm: w, hMm: h, fontFamily: o.fontFamily, fontSizePt: fs, bold: o.bold,
      color: o.color.toLowerCase(), align: o.align as LetterBoxLayout['align'], lineHeight: lh,
    };
  }

  const m = r.continuationMarginsMm as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('حاشیه‌های صفحات بعدی تعریف نشده‌اند');
  for (const k of Object.keys(m)) if (!['top', 'bottom', 'left', 'right'].includes(k)) fail(`حاشیه‌ی ناشناخته: ${k}`);
  const cm = {
    top: num(m.top, 'حاشیه‌ی بالا', 0, 120),
    bottom: num(m.bottom, 'حاشیه‌ی پایین', 0, 120),
    left: num(m.left, 'حاشیه‌ی چپ', 0, 120),
    right: num(m.right, 'حاشیه‌ی راست', 0, 120),
  };
  if (dims.h - cm.top - cm.bottom < 50 || dims.w - cm.left - cm.right < 50) fail('حاشیه‌ها آن‌قدر بزرگ‌اند که فضای کافی برای متن نمی‌ماند');
  if (boxes.body.hMm < 30 || boxes.body.wMm < 40) fail('جعبه‌ی متن نامه باید دست‌کم ۴۰×۳۰ میلی‌متر باشد');

  return { pageSize, orientation, letterheadOnAllPages: r.letterheadOnAllPages, boxes, continuationMarginsMm: cm };
}

function box(x: number, y: number, w: number, h: number, extra: Partial<LetterBoxLayout> = {}): LetterBoxLayout {
  return { visible: true, xMm: x, yMm: y, wMm: w, hMm: h, fontFamily: 'Vazirmatn', fontSizePt: 11, bold: false, color: '#000000', align: 'right', lineHeight: 1.7, ...extra };
}

/** چیدمان پیش‌فرض (A4 عمودی): بالا-چپ شماره/تاریخ/پیوست، وسط موضوع و گیرنده، متن، پایین امضا/پاراف/QR. برای سایز/جهت دیگر مقیاس می‌شود. */
export function defaultLayout(pageSize: 'A4' | 'A5' = 'A4', orientation: 'portrait' | 'landscape' = 'portrait'): LetterheadLayout {
  const base: LetterheadLayout = {
    pageSize: 'A4',
    orientation: 'portrait',
    letterheadOnAllPages: false,
    boxes: {
      number: box(15, 38, 60, 8, { align: 'left', fontSizePt: 10 }),
      date: box(15, 46, 60, 8, { align: 'left', fontSizePt: 10 }),
      attachments: box(15, 54, 60, 8, { align: 'left', fontSizePt: 10 }),
      confidentiality: box(85, 38, 40, 8, { align: 'center', bold: true, color: '#b91c1c', fontSizePt: 11 }),
      subject: box(25, 68, 170, 9, { bold: true, fontSizePt: 12 }),
      recipient: box(25, 78, 170, 16, { fontSizePt: 11 }),
      body: box(15, 98, 180, 130, { align: 'justify' }),
      signature: box(20, 232, 70, 32, { align: 'center', fontSizePt: 10 }),
      paraphs: box(100, 232, 95, 36, { fontSizePt: 8, lineHeight: 1.5 }),
      qr: box(15, 268, 22, 22, { fontSizePt: 6 }),
    },
    continuationMarginsMm: { top: 20, bottom: 20, left: 15, right: 15 },
  };
  if (pageSize === 'A4' && orientation === 'portrait') return base;
  const to = pageDims(pageSize, orientation);
  const fx = to.w / 210;
  const fy = to.h / 297;
  const boxes = {} as Record<LetterBoxKey, LetterBoxLayout>;
  for (const k of BOX_KEYS) {
    const b = base.boxes[k];
    boxes[k] = { ...b, xMm: round(b.xMm * fx), yMm: round(b.yMm * fy), wMm: round(Math.max(b.wMm * fx, 12)), hMm: round(Math.max(b.hMm * fy, 6)) };
    if (boxes[k].xMm + boxes[k].wMm > to.w) boxes[k].xMm = round(to.w - boxes[k].wMm);
    if (boxes[k].yMm + boxes[k].hMm > to.h) boxes[k].yMm = round(to.h - boxes[k].hMm);
  }
  return { pageSize, orientation, letterheadOnAllPages: false, boxes, continuationMarginsMm: { top: 15, bottom: 15, left: 12, right: 12 } };
}
const round = (n: number) => Math.round(n * 10) / 10;
