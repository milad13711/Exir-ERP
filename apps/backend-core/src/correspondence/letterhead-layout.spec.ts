import { describe, expect, it } from 'vitest';
import { BOX_KEYS, defaultLayout, pageDims, validateLayout } from './letterhead-layout.js';
import { validateBackgroundImage } from './letterhead.service.js';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('validateLayout', () => {
  it('چیدمان پیش‌فرض برای همه‌ی اندازه/جهت‌ها معتبر است', () => {
    for (const size of ['A4', 'A5'] as const)
      for (const o of ['portrait', 'landscape'] as const) {
        const l = defaultLayout(size, o);
        expect(() => validateLayout(l, size, o), `${size}-${o}`).not.toThrow();
        expect(Object.keys(l.boxes).sort()).toEqual([...BOX_KEYS].sort());
      }
  });
  it('جعبه‌ای که از برگه بیرون می‌زند رد می‌شود', () => {
    const l = clone(defaultLayout());
    l.boxes.date.xMm = 200;
    expect(() => validateLayout(l, 'A4', 'portrait')).toThrow(/بیرون/);
    const l2 = clone(defaultLayout());
    l2.boxes.qr.yMm = 290;
    expect(() => validateLayout(l2, 'A4', 'portrait')).toThrow(/پایین/);
  });
  it('عدد نامعتبر/منفی/NaN', () => {
    for (const v of [-1, NaN, Infinity, '12' as unknown as number, null as unknown as number]) {
      const l = clone(defaultLayout());
      l.boxes.number.xMm = v;
      expect(() => validateLayout(l, 'A4', 'portrait')).toThrow();
    }
  });
  it('فونت ناشناخته رد می‌شود', () => {
    const l = clone(defaultLayout());
    l.boxes.body.fontFamily = 'Comic Sans; } body{background:url(http://evil)';
    expect(() => validateLayout(l, 'A4', 'portrait')).toThrow(/فونت/);
  });
  it('اندازه‌ی فونت ۶ تا ۷۲', () => {
    for (const v of [5.9, 72.1, 0]) {
      const l = clone(defaultLayout());
      l.boxes.body.fontSizePt = v;
      expect(() => validateLayout(l, 'A4', 'portrait')).toThrow(/اندازه‌ی فونت/);
    }
    const ok = clone(defaultLayout());
    ok.boxes.body.fontSizePt = 72;
    expect(() => validateLayout(ok, 'A4', 'portrait')).not.toThrow();
  });
  it('رنگ فقط #RRGGBB', () => {
    for (const c of ['red', '#fff', '#12345g', 'rgb(0,0,0)', '#000000;background:red', 'url(x)']) {
      const l = clone(defaultLayout());
      l.boxes.body.color = c;
      expect(() => validateLayout(l, 'A4', 'portrait'), c).toThrow(/رنگ/);
    }
  });
  it('تراز، فاصله‌ی خطوط', () => {
    const l = clone(defaultLayout());
    (l.boxes.body as { align: string }).align = 'start';
    expect(() => validateLayout(l, 'A4', 'portrait')).toThrow(/تراز/);
    const l2 = clone(defaultLayout());
    l2.boxes.body.lineHeight = 5;
    expect(() => validateLayout(l2, 'A4', 'portrait')).toThrow(/فاصله/);
  });
  it('کلیدهای ناشناخته و جعبه‌ی گم‌شده', () => {
    const l = clone(defaultLayout()) as unknown as Record<string, unknown>;
    l.evil = 1;
    expect(() => validateLayout(l, 'A4', 'portrait')).toThrow(/ناشناخته/);
    const m = clone(defaultLayout());
    delete (m.boxes as Record<string, unknown>).qr;
    expect(() => validateLayout(m, 'A4', 'portrait')).toThrow(/تعریف نشده/);
    const x = clone(defaultLayout());
    (x.boxes as Record<string, unknown>).extra = x.boxes.qr;
    expect(() => validateLayout(x, 'A4', 'portrait')).toThrow(/ناشناخته/);
    const y = clone(defaultLayout());
    (y.boxes.qr as unknown as Record<string, unknown>).cssText = 'x';
    expect(() => validateLayout(y, 'A4', 'portrait')).toThrow(/ناشناخته/);
  });
  it('اندازه/جهت باید با چیدمان بخواند', () => {
    expect(() => validateLayout(defaultLayout('A5'), 'A4', 'portrait')).toThrow();
  });
  it('حاشیه‌ها: محدوده و فضای کافی', () => {
    const l = clone(defaultLayout());
    l.continuationMarginsMm.top = 130;
    expect(() => validateLayout(l, 'A4', 'portrait')).toThrow(/حاشیه/);
    const l2 = clone(defaultLayout('A5'));
    l2.continuationMarginsMm = { top: 120, bottom: 120, left: 0, right: 0 };
    expect(() => validateLayout(l2, 'A5', 'portrait')).toThrow(/فضای کافی/);
  });
  it('ورودی غیرشیء', () => {
    for (const v of [null, 5, 'x', []]) expect(() => validateLayout(v, 'A4', 'portrait')).toThrow();
  });
  it('خروجی شیء تازه است (بدون کلید اضافه)', () => {
    const l = clone(defaultLayout());
    const out = validateLayout(l, 'A4', 'portrait');
    expect(out).not.toBe(l);
    expect(out.boxes.body.color).toBe('#000000');
  });
  it('pageDims', () => {
    expect(pageDims('A4', 'landscape')).toEqual({ w: 297, h: 210 });
    expect(pageDims('A5', 'portrait')).toEqual({ w: 148, h: 210 });
  });
});

describe('validateBackgroundImage', () => {
  const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 10, 0, 0, 0, 10]), Buffer.alloc(40, 1)]).toString('base64');
  it('PNG معتبر می‌گذرد', () => expect(validateBackgroundImage(png)).toBe(png));
  it('PDF با پیام روشن رد می‌شود', () => expect(() => validateBackgroundImage('data:application/pdf;base64,JVBERi0=')).toThrow(/PDF/));
  it('WebP/SVG/جعلی رد می‌شود', () => {
    expect(() => validateBackgroundImage('data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
    expect(() => validateBackgroundImage('data:image/png;base64,' + Buffer.from('not a png at all, just text').toString('base64'))).toThrow();
  });
});
