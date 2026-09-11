import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import QRCode from 'qrcode';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';

type LabelItem = { code: string; itemDescription: string | null };

function buildHtml(items: { code: string; itemDescription: string; qrDataUrl: string }[], orgName: string, columns: number): string {
  const cells = items
    .map(
      (it) => `
      <div class="label">
        <img class="qr" src="${it.qrDataUrl}" />
        <div class="col">
          <div class="org">${escapeHtml(orgName)}</div>
          <div class="desc">${escapeHtml(it.itemDescription)}</div>
          <div class="code">${escapeHtml(it.code)}</div>
        </div>
      </div>`,
    )
    .join('\n');

  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { padding: 8mm; }
  .grid { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 3mm; }
  .label { display: flex; align-items: center; gap: 3mm; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 3mm; }
  .qr { width: 20mm; height: 20mm; flex-shrink: 0; }
  .col { min-width: 0; overflow: hidden; }
  .org { font-size: 8px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: 9px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 1mm 0; }
  .code { font-size: 10px; font-weight: 800; letter-spacing: 1px; direction: ltr; }
</style>
</head>
<body>
  <div class="grid">${cells}</div>
</body>
</html>`;
}

/** لیبل چاپی گارانتی (QR + کد + عنوان کالا) — چیدمان شبکه‌ای چندستونه روی یک برگه، همان الگوی Puppeteer مشترک با EventsTicketPdfService. */
@Injectable()
export class WarrantyLabelPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('WarrantyLabelPdfService');
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

  async render(items: LabelItem[], orgName: string, columns = 4): Promise<Buffer> {
    const withQr = await Promise.all(
      items.map(async (it) => ({
        code: it.code,
        itemDescription: it.itemDescription ?? '',
        qrDataUrl: await QRCode.toDataURL(it.code, { errorCorrectionLevel: 'M', margin: 0, width: 200 }),
      })),
    );

    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(buildHtml(withQr, orgName, Math.max(1, Math.min(8, columns))), { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '6mm', bottom: '6mm', right: '6mm', left: '6mm' } });
      return Buffer.from(pdf);
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
