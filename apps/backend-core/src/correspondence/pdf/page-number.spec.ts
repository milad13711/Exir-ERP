import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE_NUMBER_OPTIONS, defaultLayout, validateLayout, validatePageNumberOptions, withLayoutDefaults } from '../letterhead-layout.js';
import type { LetterRenderInput } from '../render-input.js';
import { buildLetterHtml } from './letter-html.js';

const base = (layout = defaultLayout()): LetterRenderInput => ({
  letterhead: { imageDataUri: null, layout }, number: '1', dateText: 'd', subject: 's', bodyHtml: '<p>x</p>', attachmentsText: null,
  recipients: [{ name: 'a' }], ccNames: [], sender: { name: 'f' }, paraphs: [], signature: null, qr: null, watermark: null, confidentialityLabel: null, priorityLabel: null,
});
const opts = (pageTotal: number | null, persianDigits = false) => ({ qrDataUri: null, flow: true, pageTotal, persianDigits });
const labels = (html: string) => [...html.matchAll(/class="box pnum" style="([^"]*)">([^<]*)</g)].map((m) => ({ style: m[1], text: m[2] }));

describe('pageNumber box defaults and compat', () => {
  it('default box sits bottom-centre, 18mm above the paper edge (clear of the usual footer) and above the text area', () => {
    const lay = defaultLayout();
    const b = lay.boxes.pageNumber;
    expect(b).toMatchObject({ visible: true, xMm: 75, yMm: 274, wMm: 60, hMm: 5, align: 'center' });
    expect(297 - (b.yMm + b.hMm)).toBe(18);
    expect(297 - lay.continuationMarginsMm.bottom).toBeLessThanOrEqual(b.yMm); // متن ادامه روی شماره‌ی صفحه نمی‌افتد
    expect(lay.pageNumberOptions).toEqual(DEFAULT_PAGE_NUMBER_OPTIONS);
    expect(validateLayout(lay, 'A4', 'portrait')).toEqual(lay);
  });
  it('A5 and landscape defaults stay inside the page and validate', () => {
    for (const [s, o] of [['A5', 'portrait'], ['A4', 'landscape'], ['A5', 'landscape']] as const) {
      const lay = defaultLayout(s, o);
      expect(() => validateLayout(lay, s, o)).not.toThrow();
    }
  });
  it('old stored layouts without pageNumber/pageNumberOptions are filled with defaults on read (no DB backfill)', () => {
    const old = JSON.parse(JSON.stringify(defaultLayout())) as Record<string, unknown>;
    delete (old.boxes as Record<string, unknown>).pageNumber;
    delete old.pageNumberOptions;
    const filled = withLayoutDefaults(old, 'A4', 'portrait') as ReturnType<typeof defaultLayout>;
    expect(filled.boxes.pageNumber).toEqual(defaultLayout().boxes.pageNumber);
    expect(filled.pageNumberOptions).toEqual(DEFAULT_PAGE_NUMBER_OPTIONS);
    expect(validateLayout(old, 'A4', 'portrait').boxes.pageNumber.yMm).toBe(274);
    expect(Object.keys(old.boxes as object)).not.toContain('pageNumber'); // ورودی دست‌نخورده
  });
  it('options validation', () => {
    expect(validatePageNumberOptions(undefined)).toEqual(DEFAULT_PAGE_NUMBER_OPTIONS);
    expect(validatePageNumberOptions({ format: '{n}/{total}', startFromPage: 2 })).toMatchObject({ format: '{n}/{total}', startFromPage: 2 });
    for (const bad of [{ format: '' }, { format: 'صفحه' }, { format: '{n}<b>' }, { format: '{n}{x}' }, { format: 'x'.repeat(41) + '{n}' }, { format: '{n}', startFromPage: 0 }, { format: '{n}', startFromPage: 1.5 }, { format: '{n}', showOnFirstPage: 'yes' }, { format: '{n}', extra: 1 }]) {
      expect(() => validatePageNumberOptions(bad), JSON.stringify(bad)).toThrow(BadRequestException);
    }
  });
});

describe('page number layout snapshots (1, 2 and 5 pages) with a custom box', () => {
  const custom = () => {
    const lay = defaultLayout();
    lay.boxes.pageNumber = { ...lay.boxes.pageNumber, xMm: 20, yMm: 10, wMm: 40, hMm: 6, align: 'left', fontSizePt: 12, bold: true, color: '#112233', fontFamily: 'Tahoma' };
    lay.pageNumberOptions = { format: '{n}/{total}', startFromPage: 1, showOnFirstPage: true, showOnSinglePage: false, persianDigits: false };
    return lay;
  };
  it('1 page → nothing (unless showOnSinglePage)', () => {
    expect(labels(buildLetterHtml(base(custom()), opts(1)))).toEqual([]);
    const lay = custom();
    lay.pageNumberOptions!.showOnSinglePage = true;
    expect(labels(buildLetterHtml(base(lay), opts(1))).map((l) => l.text)).toEqual(['1/1']);
  });
  it('2 pages → one label per page exactly on the box coordinates, with the box typography', () => {
    const l = labels(buildLetterHtml(base(custom()), opts(2)));
    expect(l.map((x) => x.text)).toEqual(['1/2', '2/2']);
    expect(l[0].style).toContain('left:20mm;top:10mm;width:40mm;height:6mm;');
    expect(l[1].style).toContain('left:20mm;top:307mm;width:40mm;height:6mm;'); // 297 + 10
    expect(l[0].style).toContain('justify-content:flex-start');
    expect(l[0].style).toContain('font-size:12pt');
    expect(l[0].style).toContain('font-weight:700');
    expect(l[0].style).toContain('color:#112233');
    expect(l[0].style).toContain("font-family:'Tahoma'");
  });
  it('5 pages, start from page 3 and hidden on first page', () => {
    const lay = custom();
    lay.pageNumberOptions = { format: 'صفحه {n} از {total}', startFromPage: 3, showOnFirstPage: false, showOnSinglePage: false, persianDigits: true };
    const l = labels(buildLetterHtml(base(lay), opts(5)));
    expect(l.map((x) => x.text)).toEqual(['صفحه ۳ از ۵', 'صفحه ۴ از ۵', 'صفحه ۵ از ۵']);
    expect(l.map((x) => /top:(\d+)mm/.exec(x.style)![1])).toEqual(['604', '901', '1198']); // 2*297+10 ...
  });
  it('first page can be hidden while later pages are numbered; hidden box prints nothing', () => {
    const lay = custom();
    lay.pageNumberOptions!.showOnFirstPage = false;
    expect(labels(buildLetterHtml(base(lay), opts(3))).map((x) => x.text)).toEqual(['2/3', '3/3']);
    lay.boxes.pageNumber.visible = false;
    expect(labels(buildLetterHtml(base(lay), opts(3)))).toEqual([]);
  });
  it('format text is HTML-escaped (defence in depth even though validation forbids < >)', () => {
    const lay = custom();
    (lay.pageNumberOptions as { format: string }).format = '<i>{n}</i>';
    expect(buildLetterHtml(base(lay), opts(2))).not.toContain('<i>1</i>');
  });
  it('the old fixed bottom position is gone', () => {
    expect(buildLetterHtml(base(), opts(3))).not.toContain('class="pn"');
  });
});
