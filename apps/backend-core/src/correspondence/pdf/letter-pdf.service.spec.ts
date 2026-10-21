import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handler: null as null | ((req: unknown) => void),
  jsEnabled: undefined as boolean | undefined,
  interception: undefined as boolean | undefined,
  pdfCalls: 0,
  contents: [] as string[],
  pages: 1,
  closed: 0,
  delayMs: 0,
}));

vi.mock('puppeteer', () => {
  const page = {
    setJavaScriptEnabled: async (v: boolean) => void (state.jsEnabled = v),
    setRequestInterception: async (v: boolean) => void (state.interception = v),
    on: (ev: string, h: (r: unknown) => void) => void (ev === 'request' && (state.handler = h)),
    setContent: async (html: string) => {
      state.contents.push(html);
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    },
    pdf: async () => {
      state.pdfCalls++;
      return Buffer.from(`%PDF-1.4\n<< /Type /Pages /Kids [] /Count ${state.pages} >>\n%%EOF`);
    },
    close: async () => void state.closed++,
  };
  const browser = { connected: true, createBrowserContext: async () => ({ newPage: async () => ({ ...page }), close: async () => undefined }), close: async () => undefined };
  return { default: { launch: async () => browser } };
});

import { LetterPdfService, countPdfPages, isAllowedLetterRequestUrl, normalizeLetterInput } from './letter-pdf.service.js';
import { defaultLayout } from '../letterhead-layout.js';
import type { LetterRenderInput } from '../render-input.js';

const base = (over: Partial<LetterRenderInput> = {}): LetterRenderInput => ({
  letterhead: { imageDataUri: null, layout: defaultLayout() }, number: '1', dateText: 'd', subject: 's', bodyHtml: '<p>x</p>', attachmentsText: null,
  recipients: [{ name: 'a' }], ccNames: [], sender: { name: 'f' }, paraphs: [], signature: null, qr: { verifyUrl: 'https://x.test/v' },
  watermark: null, confidentialityLabel: null, priorityLabel: null, ...over,
});

beforeEach(() => {
  Object.assign(state, { handler: null, jsEnabled: undefined, interception: undefined, pdfCalls: 0, contents: [], pages: 1, closed: 0, delayMs: 0 });
});

describe('LetterPdfService (puppeteer mock)', () => {
  it('JS خاموش و intercept روشن؛ فقط data: عبور می‌کند', async () => {
    await new LetterPdfService().render(base());
    expect(state.jsEnabled).toBe(false);
    expect(state.interception).toBe(true);
    const req = (url: string) => ({ url: () => url, continue: vi.fn(), abort: vi.fn() });
    for (const url of ['http://169.254.169.254/latest', 'https://evil.test/x.png', 'file:///etc/passwd', 'ftp://x', 'ws://x', 'blob:http://x/1', 'about:srcdoc', 'chrome://version']) {
      const r = req(url);
      state.handler!(r);
      expect(r.abort, url).toHaveBeenCalledWith('blockedbyclient');
      expect(r.continue, url).not.toHaveBeenCalled();
    }
    for (const url of ['data:image/png;base64,AAAA', 'data:font/woff2;base64,AAAA', 'about:blank']) {
      const r = req(url);
      state.handler!(r);
      expect(r.continue, url).toHaveBeenCalled();
      expect(r.abort).not.toHaveBeenCalled();
    }
  });
  it('isAllowedLetterRequestUrl', () => {
    expect(isAllowedLetterRequestUrl('data:text/html,x')).toBe(true);
    expect(isAllowedLetterRequestUrl('DATA:x')).toBe(false); // حساس به حروف: رد (امن‌تر)
    expect(isAllowedLetterRequestUrl('http://a')).toBe(false);
  });
  it('تک‌صفحه: یک رندر؛ صفحه بسته می‌شود', async () => {
    const pdf = await new LetterPdfService().render(base());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(state.pdfCalls).toBe(1);
    expect(state.closed).toBe(1);
  });
  it('چندصفحه‌ای: رندر جریان + رندر شماره‌ی صفحه', async () => {
    state.pages = 3;
    await new LetterPdfService().render(base());
    expect(state.pdfCalls).toBe(3);
    expect(state.contents[0]).not.toContain('class="tail"><div');
    expect(state.contents[1]).toContain('class="tailbox qr"');
    expect(state.contents[2]).toContain('صفحه ۱ از ۳');
  });
  it('بدنه پیش از رندر دوباره پاک‌سازی می‌شود (اعتماد به ورودی نیست)', async () => {
    await new LetterPdfService().render(base({ bodyHtml: '<p>ok</p><script>alert(1)</script><img src="http://evil/x" onerror=1>' }));
    expect(state.contents[0]).toContain('<p>ok</p>');
    expect(state.contents[0]).not.toContain('alert(1)');
    expect(state.contents[0]).not.toContain('http://evil');
  });
  it('سقف‌ها: بدنه، پاراف، تصویر', async () => {
    const svc = new LetterPdfService();
    await expect(svc.render(base({ bodyHtml: '<p>' + 'x'.repeat(520 * 1024) + '</p>' }))).rejects.toThrow(/بزرگ/);
    const paraphs = Array.from({ length: 21 }, () => ({ authorName: 'a', text: 't', dateText: 'd' }));
    await expect(svc.render(base({ paraphs }))).rejects.toThrow(/پاراف/);
    await expect(svc.render(base({ letterhead: { imageDataUri: 'http://evil/x.png', layout: defaultLayout() } }))).rejects.toThrow(/سربرگ/);
    const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3.2 * 1024 * 1024)]).toString('base64');
    await expect(svc.render(base({ signature: { imageDataUri: big, stampDataUri: null, signerName: 'x', signedAtText: 'd' } }))).rejects.toThrow(/امضا/);
    expect(state.pdfCalls).toBe(0);
  });
  it('چیدمان نامعتبر رد می‌شود', async () => {
    const l = defaultLayout();
    l.boxes.body.fontFamily = 'Evil';
    await expect(new LetterPdfService().render(base({ letterhead: { imageDataUri: null, layout: l } }))).rejects.toThrow(/فونت/);
  });
  it('QR فقط برای http(s)', () => {
    expect(normalizeLetterInput(base({ qr: { verifyUrl: 'javascript:alert(1)' } })).qr).toBeNull();
    expect(normalizeLetterInput(base({ qr: { verifyUrl: 'https://a.test/x' } })).qr).not.toBeNull();
    expect(normalizeLetterInput(base({ watermark: 'x' as never })).watermark).toBeNull();
  });
  it('صف هم‌زمانی: حداکثر maxConcurrency هم‌زمان و صف پر → 503', async () => {
    state.delayMs = 30;
    const svc = new LetterPdfService();
    let running = 0;
    let peak = 0;
    const orig = (svc as unknown as { htmlToPdf: (h: string, d: number, j: unknown) => Promise<Buffer> }).htmlToPdf.bind(svc);
    (svc as unknown as { htmlToPdf: unknown }).htmlToPdf = async (h: string, d: number, j: unknown) => {
      running++;
      peak = Math.max(peak, running);
      try {
        return await orig(h, d, j);
      } finally {
        running--;
      }
    };
    await Promise.all(Array.from({ length: 6 }, (_, i) => svc.render(base(), { tenantId: `t${i}`, userId: `u${i}` })));
    expect(peak).toBeLessThanOrEqual(svc.maxConcurrency);
    const many = Array.from({ length: svc.maxConcurrency + svc.maxQueue + 5 }, (_, i) => svc.render(base(), { tenantId: `tt${i}`, userId: `uu${i}` }).then(() => 'ok', (e: Error) => e.message));
    const results = await Promise.all(many);
    expect(results.some((r) => /شلوغ/.test(r))).toBe(true);
  });
  it('تایم‌اوت سخت', async () => {
    state.delayMs = 400;
    process.env.LETTER_PDF_TIMEOUT_MS = '5000';
    const svc = new LetterPdfService();
    (svc as unknown as { timeoutMs: number }).timeoutMs = 50;
    await expect(svc.render(base())).rejects.toThrow(/طول کشید/);
    delete process.env.LETTER_PDF_TIMEOUT_MS;
  });
  it('برگ ثبت وارده و برچسب', async () => {
    const svc = new LetterPdfService();
    const slipIn = { orgName: 'o', secretariatNumber: '1', registeredAtText: 'd', externalNumber: null, externalDateText: null, senderName: 's', subject: 'x', pageCount: 2, attachmentsText: null, registrarName: 'r', qr: { verifyUrl: 'https://a.test/1' } };
    await svc.renderIncomingSlip(slipIn);
    await svc.renderIncomingSlip(slipIn, { variant: 'label' });
    expect(state.contents[0]).toContain('size:148mm 105mm');
    expect(state.contents[1]).toContain('size:60mm 40mm');
    await expect(svc.renderIncomingSlip(slipIn, { headerImageDataUri: 'http://evil/x.png' })).rejects.toThrow(/سربرگ/);
    expect(state.jsEnabled).toBe(false);
  });
});

describe('countPdfPages', () => {
  it('Count ریشه و بازگشت به شمارش Page', () => {
    expect(countPdfPages(Buffer.from('/Type /Pages /Kids [1 0 R] /Count 4'))).toBe(4);
    expect(countPdfPages(Buffer.from('<</Count 2 /Kids [] /Type /Pages>>'))).toBe(2);
    expect(countPdfPages(Buffer.from('/Type /Page /A /Type /Page'))).toBe(2);
    expect(countPdfPages(Buffer.from('nothing'))).toBe(1);
  });
});
