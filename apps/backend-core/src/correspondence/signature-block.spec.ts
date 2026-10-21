import { describe, expect, it, vi } from 'vitest';
import { defaultLayout } from './letterhead-layout.js';
import { buildLetterHtml } from './pdf/letter-html.js';
import { DEFAULT_SIGNATURE_DEFAULTS, fillTemplate, freezeSignatureBlock, resolveSignatureBlock, sanitizeDefaults, sanitizeSignatureBlock, validateTemplate } from './signature-block.js';
import { CorrespondenceSignatureService } from './correspondence-signature.service.js';
import { CorrespondenceRenderService } from './correspondence-render.service.js';
import type { LetterRenderInput } from './render-input.js';

const R = { profileName: 'علی رضایی', profileTitle: 'مدیرعامل', orgName: 'شرکت اکسیرتجارت امین' };

describe('resolveSignatureBlock', () => {
  it('defaults: «سمت + شرکت» and «پیشوند + نام» from profile and org', () => {
    const r = resolveSignatureBlock({ block: null, defaults: { ...DEFAULT_SIGNATURE_DEFAULTS, honorific: 'آقای' }, ...R });
    expect(r.titleLine).toBe('مدیرعامل شرکت اکسیرتجارت امین');
    expect(r.nameLine).toBe('آقای علی رضایی');
    expect(r.showDate).toBe(true);
  });
  it('user edits win over per-signer overrides, which win over org defaults and the profile', () => {
    const defaults = { ...DEFAULT_SIGNATURE_DEFAULTS, honorific: 'آقای', perSigner: { u1: { signerTitle: 'رئیس هیئت‌مدیره', honorific: 'دکتر', showDate: false } } };
    const per = resolveSignatureBlock({ block: null, defaults, signerUserId: 'u1', ...R });
    expect(per).toMatchObject({ titleLine: 'رئیس هیئت‌مدیره شرکت اکسیرتجارت امین', nameLine: 'دکتر علی رضایی', showDate: false });
    const edited = resolveSignatureBlock({ block: { signerTitle: 'معاون', honorific: '', showDate: true }, defaults, signerUserId: 'u1', ...R });
    expect(edited).toMatchObject({ titleLine: 'معاون شرکت اکسیرتجارت امین', nameLine: 'علی رضایی', showDate: true });
    const other = resolveSignatureBlock({ block: {}, defaults, signerUserId: 'u2', ...R });
    expect(other.nameLine).toBe('آقای علی رضایی');
  });
  it('empty pieces collapse cleanly (no stray spaces or placeholders)', () => {
    const r = resolveSignatureBlock({ block: { orgName: '', signerTitle: 'مدیر' }, defaults: DEFAULT_SIGNATURE_DEFAULTS, ...R, profileName: '' });
    expect(r.titleLine).toBe('مدیر');
    expect(r.nameLine).toBe('');
  });
  it('after signing the frozen lines are used verbatim — later setting changes cannot alter the letter', () => {
    const first = resolveSignatureBlock({ block: null, defaults: DEFAULT_SIGNATURE_DEFAULTS, ...R });
    const frozen = freezeSignatureBlock(first);
    const changed = { ...DEFAULT_SIGNATURE_DEFAULTS, titleTemplate: 'X {{orgName}}', honorific: 'خانم' };
    const again = resolveSignatureBlock({ block: frozen, defaults: changed, ...R, profileName: 'نام دیگر', orgName: 'شرکت دیگر' });
    expect(again.titleLine).toBe(first.titleLine);
    expect(again.nameLine).toBe(first.nameLine);
  });
});

describe('templates and sanitising', () => {
  it('only the four placeholders are allowed; markup and unknown tokens are rejected', () => {
    expect(validateTemplate('{{signerTitle}} {{orgName}}', 'x')).toBe('{{signerTitle}} {{orgName}}');
    expect(() => validateTemplate('{{foo}}', 'x')).toThrow(/ناشناخته/);
    expect(() => validateTemplate('<b>{{orgName}}</b>', 'x')).toThrow();
    expect(() => validateTemplate('{{orgName', 'x')).toThrow();
    expect(() => validateTemplate('   ', 'x')).toThrow(/خالی/);
    expect(fillTemplate('{{a}} {{honorific}}  {{signerName}}', { honorific: 'آقای', signerName: 'ع' })).toBe('آقای ع');
  });
  it('client input is cleaned (bidi/control chars, lengths) and can never set the frozen lines', () => {
    const b = sanitizeSignatureBlock({ signerTitle: 'مدیر‮', orgName: ' x '.repeat(100), signerName: 'ع⁦ی', honorific: 'آقای', showDate: false, titleLine: 'HACK', nameLine: 'HACK', evil: 1 });
    expect(b).toEqual({ signerTitle: 'مدیر', orgName: expect.any(String), signerName: 'عی', honorific: 'آقای', showDate: false });
    expect(b.orgName!.length).toBeLessThanOrEqual(120);
    expect(sanitizeSignatureBlock('x')).toEqual({});
    expect(sanitizeSignatureBlock(null)).toEqual({});
  });
  it('defaults sanitising: bad user ids and templates dropped/rejected', () => {
    const d = sanitizeDefaults({ titleTemplate: '{{signerTitle}}', perSigner: { 'ok-1': { honorific: 'دکتر', showDate: false }, 'bad id!': { honorific: 'x' }, empty: {} } });
    expect(Object.keys(d.perSigner)).toEqual(['ok-1']);
    expect(() => sanitizeDefaults({ titleTemplate: '{{nope}}' })).toThrow();
    expect(sanitizeDefaults(undefined)).toEqual(DEFAULT_SIGNATURE_DEFAULTS);
  });
});

describe('signature service (settings storage)', () => {
  it('stores and reads org/per-signer defaults; setDefaults gives a Persian 400 for bad templates', async () => {
    let stored: unknown = null;
    const ctx = { tenantId: 't', tenantDb: { moduleSetting: {
      findUnique: async () => (stored ? { value: stored } : null),
      upsert: async ({ create }: { create: { value: unknown } }) => { stored = create.value; },
    } } } as never;
    const svc = new CorrespondenceSignatureService();
    expect((await svc.getDefaults(ctx)).titleTemplate).toBe(DEFAULT_SIGNATURE_DEFAULTS.titleTemplate);
    await svc.setDefaults(ctx, { honorific: 'آقای', perSigner: { u1: { signerTitle: 'مدیرعامل' } } });
    expect((await svc.getDefaults(ctx)).perSigner.u1.signerTitle).toBe('مدیرعامل');
    await expect(svc.setDefaults(ctx, { titleTemplate: '<script>' })).rejects.toThrow(/قالب/);
  });
});

// ───────── رندر ─────────
const base = (sig: LetterRenderInput['signature'], layout = defaultLayout()): LetterRenderInput => ({
  letterhead: { imageDataUri: null, layout }, number: '1', dateText: 'd', subject: 's', bodyHtml: '<p>x</p>', attachmentsText: null,
  recipients: [{ name: 'a' }], ccNames: [], sender: { name: 'f', title: 'ت' }, paraphs: [], signature: sig, qr: null, watermark: null, confidentialityLabel: null, priorityLabel: null,
});
const PX = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 10, 0, 0, 0, 10]), Buffer.alloc(8, 1)]).toString('base64');
const opts = (flow: boolean) => ({ qrDataUri: null, flow, pageTotal: null, persianDigits: false });

describe('signature block HTML', () => {
  const sig = { imageDataUri: PX, stampDataUri: PX, signerName: 'علی رضایی', signerTitle: 'مدیرعامل', signedAtText: '1405/08/01 10:30', titleLine: 'مدیرعامل شرکت اکسیرتجارت امین', nameLine: 'آقای علی رضایی', dateLabel: '1405/08/01 10:30' };

  it('three centred lines in order: title+company, honorific+name, then stamp/signature images; optional date last', () => {
    const html = buildLetterHtml(base(sig), opts(false));
    const i1 = html.indexOf('class="sl1">مدیرعامل شرکت اکسیرتجارت امین');
    const i2 = html.indexOf('class="sl2">آقای علی رضایی');
    const i3 = html.indexOf('class="sigimgs"');
    const i4 = html.indexOf('class="sd">1405/08/01 10:30');
    expect(i1).toBeGreaterThan(0);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
    expect(html).toContain('.sig{text-align:center;}');
  });
  it('date hidden when dateLabel is null; falls back to old fields when no lines are given', () => {
    expect(buildLetterHtml(base({ ...sig, dateLabel: null }), opts(false))).not.toContain('class="sd"');
    const legacy = buildLetterHtml(base({ imageDataUri: null, stampDataUri: null, signerName: 'امضاکننده', signerTitle: 'سمت', signedAtText: 'تاریخ' }), opts(false));
    expect(legacy).toContain('class="sl1">سمت');
    expect(legacy).toContain('class="sl2">امضاکننده');
    expect(legacy).toContain('class="sd">تاریخ');
  });
  it('line texts are HTML-escaped', () => {
    const html = buildLetterHtml(base({ ...sig, titleLine: '<img src=x onerror=alert(1)>', nameLine: '"><script>' }), opts(false));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });
  it('default signature box sits at the bottom-right corner under the body text (right edges aligned)', () => {
    const b = defaultLayout().boxes;
    expect(b.signature.xMm + b.signature.wMm).toBe(b.body.xMm + b.body.wMm); // لبه‌ی راست = لبه‌ی راست متن
    expect(b.signature.yMm).toBeGreaterThanOrEqual(b.body.yMm + b.body.hMm); // زیر متن
    expect(b.signature.align).toBe('center'); // وسط‌چین داخل بلوک
    expect(b.paraphs.xMm + b.paraphs.wMm).toBeLessThanOrEqual(b.signature.xMm); // پاراف‌ها سمت چپ، همپوشانی ندارد
    expect(b.pageNumber.yMm).toBeGreaterThanOrEqual(b.signature.yMm + b.signature.hMm); // شماره‌ی صفحه زیر بلوک
  });
  it('flow mode: block comes after the text at the right end and never splits across pages', () => {
    const html = buildLetterHtml(base(sig), opts(true));
    expect(html).toMatch(/<div class="tailbox signature" style="[^"]*margin-left:auto/);
    expect(html).toContain('.tailbox.signature{break-inside:avoid;page-break-inside:avoid;}');
    expect(html.indexOf('class="tailbox signature"')).toBeGreaterThan(html.indexOf('<div class="body">'));
  });
});

describe('render service builds the three-line block', () => {
  function svc(signatures: { resolve: (...a: never[]) => unknown }) {
    const stamps = { getStamp: async () => ({ signatureImage: 'S', stampImage: 'M' }) };
    return new CorrespondenceRenderService({} as never, stamps as never, signatures as never);
  }
  const letter = { id: 'L', letterNumber: 'N', letterDate: new Date('2026-10-20T08:00:00Z'), subject: 's', bodyHtml: '<p>x</p>', recipients: [], ccNames: [], createdByName: 'c', letterheadId: null, confidentiality: 'NORMAL', priority: 'NORMAL', attachmentsText: null, signatureBlock: null, signerUserId: 'sg', createdByUserId: 'cr', signedByUserId: null } as never;
  const ctx = { tenantDb: { corrLetterhead: { findFirst: async () => null } } } as never;
  const resolved = { fields: { signerTitle: 'مدیر', orgName: 'شرکت', signerName: 'علی', honorific: 'آقای', showDate: true }, titleLine: 'مدیر شرکت', nameLine: 'آقای علی', showDate: true };

  it('draft: lines present, no images, no date', async () => {
    const resolve = vi.fn(async () => resolved);
    const out = await svc({ resolve }).build(ctx, letter, { paraphs: [], attachmentTitles: [], signature: null, watermark: 'پیش‌نویس', withQr: false });
    expect(out.signature).toMatchObject({ titleLine: 'مدیر شرکت', nameLine: 'آقای علی', imageDataUri: null, stampDataUri: null, dateLabel: null });
    expect(resolve).toHaveBeenCalledWith(ctx, 'sg', null, undefined); // امضاکننده‌ی تعیین‌شده برای پیش‌فرض‌ها
  });
  it('signed: images only when the stamp was used, date label follows showDate', async () => {
    const signed = { signerName: 'علی', signerTitle: 'مدیر', signedAt: new Date('2026-10-20T08:00:00Z'), useStamp: true };
    const a = await svc({ resolve: async () => resolved }).build(ctx, letter, { paraphs: [], attachmentTitles: [], signature: signed, watermark: null, withQr: true });
    expect(a.signature).toMatchObject({ imageDataUri: 'S', stampDataUri: 'M' });
    expect(a.signature!.dateLabel).toBeTruthy();
    const b = await svc({ resolve: async () => ({ ...resolved, showDate: false }) }).build(ctx, letter, { paraphs: [], attachmentTitles: [], signature: { ...signed, useStamp: false }, watermark: null, withQr: true });
    expect(b.signature).toMatchObject({ imageDataUri: null, dateLabel: null });
  });
});
