import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { formatJalaliDate } from '../common/persian.js';
import { hardenPage, safeImgSrc } from '../security/puppeteer-hardening.js';

export type PosterTemplateCode = 'post-square' | 'story';

const DIMENSIONS: Record<PosterTemplateCode, { width: number; height: number }> = {
  'post-square': { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

function buildHtml(
  code: PosterTemplateCode,
  opts: { title: string; dateLabel: string; venue: string; coverImage: string | null; brandColor: string },
): string {
  const { width, height } = DIMENSIONS[code];
  const titleSize = code === 'story' ? 66 : 54;

  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; }
  .frame {
    width: 100%; height: 100%; position: relative;
    background: linear-gradient(150deg, ${opts.brandColor} 0%, #1a1a2e 100%);
    display: flex; flex-direction: column; color: #ffffff; direction: rtl; text-align: center;
  }
  .cover { width: 100%; height: 46%; object-fit: cover; opacity: 0.9; }
  .content { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; padding: 60px 70px; }
  .title { font-size: ${titleSize}px; font-weight: 800; line-height: 1.4; text-wrap: balance; }
  .meta { font-size: 32px; font-weight: 600; opacity: 0.92; }
  .badge {
    display: inline-block; background: #ffffff; color: ${opts.brandColor};
    font-size: 32px; font-weight: 800; padding: 20px 52px; border-radius: 999px;
  }
  .footer { font-size: 24px; opacity: 0.7; padding: 30px; }
</style>
</head>
<body>
  <div class="frame">
    ${opts.coverImage ? `<img class="cover" src="${safeImgSrc(opts.coverImage)}" />` : ""}
    <div class="content">
      <div class="title">${escapeHtml(opts.title)}</div>
      <div class="meta">${escapeHtml(opts.dateLabel)}</div>
      ${opts.venue ? `<div class="meta">${escapeHtml(opts.venue)}</div>` : ''}
      <div class="badge">ثبت‌نام</div>
    </div>
    <div class="footer">اکسیر ERP</div>
  </div>
</body>
</html>`;
}

/** پوستر رویداد برای انتشار در استوری/پست اینستاگرام یا واتس‌اپ — همان الگوی Puppeteer/Chromium مشترک با CampaignImageService، فقط تصویر کاور رویداد هم اگر موجود باشد داخل قالب می‌آید. */
@Injectable()
export class EventsPosterService implements OnModuleDestroy {
  private readonly logger = new Logger('EventsPosterService');
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
    code: PosterTemplateCode,
    event: { title: string; startAt: Date; venue: string | null; coverImage: string | null },
    brandColor = '#4f46e5',
  ): Promise<Buffer> {
    const { width, height } = DIMENSIONS[code];
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await hardenPage(page);
    try {
      await page.setViewport({ width, height });
      await page.setContent(
        buildHtml(code, { title: event.title, dateLabel: formatJalaliDate(event.startAt), venue: event.venue ?? '', coverImage: event.coverImage, brandColor }),
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
