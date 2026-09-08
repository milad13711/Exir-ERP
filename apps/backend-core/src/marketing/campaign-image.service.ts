import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';

export type TemplateCode = 'post-square' | 'story';

const DIMENSIONS: Record<TemplateCode, { width: number; height: number }> = {
  'post-square': { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

function buildHtml(
  code: TemplateCode,
  storeName: string,
  title: string,
  body: string,
  cta: string,
  brandColor: string,
): string {
  const { width, height } = DIMENSIONS[code];
  const titleSize = code === 'story' ? 72 : 60;
  const bodySize = code === 'story' ? 38 : 32;

  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; }
  .frame {
    width: 100%; height: 100%;
    background: linear-gradient(150deg, ${brandColor} 0%, #1a1a2e 100%);
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 90px 80px; color: #ffffff; direction: rtl; text-align: center;
  }
  .store { font-size: 34px; font-weight: 700; opacity: 0.9; }
  .content { display: flex; flex-direction: column; align-items: center; gap: 32px; }
  .title { font-size: ${titleSize}px; font-weight: 800; line-height: 1.4; text-wrap: balance; }
  .body { font-size: ${bodySize}px; font-weight: 400; line-height: 1.7; opacity: 0.95; max-width: 90%; margin: 0 auto; }
  .cta {
    display: inline-block; align-self: center; background: #ffffff; color: ${brandColor};
    font-size: 34px; font-weight: 800; padding: 22px 56px; border-radius: 999px;
  }
  .footer { font-size: 24px; opacity: 0.7; }
</style>
</head>
<body>
  <div class="frame">
    <div class="store">${escapeHtml(storeName)}</div>
    <div class="content">
      <div class="title">${escapeHtml(title)}</div>
      ${body ? `<div class="body">${escapeHtml(body)}</div>` : ''}
      ${cta ? `<div class="cta">${escapeHtml(cta)}</div>` : ''}
    </div>
    <div class="footer">اکسیر ERP</div>
  </div>
</body>
</html>`;
}

/**
 * تصویر پست/استوری اینستاگرام از روی یک قالب ثابت با متن قابل تغییر —
 * هیچ ارسال واقعی به اینستاگرام انجام نمی‌شود (چنین APIای برای این کاربرد
 * وجود ندارد)؛ فقط تصویر آماده‌ی انتشار دستی تولید می‌کند. همان الگوی
 * Puppeteer/Chromium مشترک با SalesInvoicePdfService، اما screenshot به‌جای pdf.
 */
@Injectable()
export class CampaignImageService implements OnModuleDestroy {
  private readonly logger = new Logger('CampaignImageService');
  private browserPromise: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browserPromise;
  }

  async render(
    code: TemplateCode,
    opts: { storeName: string; title: string; body: string; cta: string; brandColor?: string },
  ): Promise<Buffer> {
    const { width, height } = DIMENSIONS[code];
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width, height });
      await page.setContent(
        buildHtml(code, opts.storeName, opts.title, opts.body, opts.cta, opts.brandColor ?? '#4f46e5'),
        { waitUntil: 'load' },
      );
      const png = await page.screenshot({ type: 'png' });
      return Buffer.from(png);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) {
      try {
        await (await this.browserPromise).close();
      } catch (err) {
        this.logger.warn(`Failed closing Chromium: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
