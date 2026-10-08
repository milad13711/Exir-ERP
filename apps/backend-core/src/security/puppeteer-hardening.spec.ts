import { describe, expect, it, vi } from 'vitest';
import { hardenPage, isAllowedPuppeteerUrl, safeImgSrc } from './puppeteer-hardening.js';

describe('puppeteer hardening', () => {
  it('allows only data:/about:blank/blob: sub-requests', () => {
    for (const u of ['data:font/woff2;base64,AAAA', 'about:blank', 'blob:abc']) expect(isAllowedPuppeteerUrl(u), u).toBe(true);
    for (const u of ['file:///etc/passwd', 'http://169.254.169.254/latest/meta-data/', 'https://evil.example/x.png', 'http://localhost:3001/api/admin', 'ftp://x']) expect(isAllowedPuppeteerUrl(u), u).toBe(false);
  });

  it('hardenPage disables JS and aborts every non-data request', async () => {
    const handlers: Array<(r: unknown) => void> = [];
    const page = { setJavaScriptEnabled: vi.fn(), setRequestInterception: vi.fn(), on: (_e: string, h: (r: unknown) => void) => handlers.push(h) };
    await hardenPage(page as never);
    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    const mk = (url: string) => ({ url: () => url, continue: vi.fn(), abort: vi.fn() });
    const ok = mk('data:image/png;base64,AAAA');
    const bad = mk('http://10.0.0.1/admin');
    handlers[0](ok); handlers[0](bad);
    expect(ok.continue).toHaveBeenCalled();
    expect(bad.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(bad.continue).not.toHaveBeenCalled();
  });

  it('safeImgSrc passes only base64 image data URIs (no attribute injection, no external URLs)', () => {
    expect(safeImgSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    for (const bad of ['http://evil/x.png', 'x" onerror="alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,AAA" onload="x', 'javascript:alert(1)', undefined, null, 5]) {
      expect(safeImgSrc(bad as never), String(bad)).toBe('');
    }
  });
});
