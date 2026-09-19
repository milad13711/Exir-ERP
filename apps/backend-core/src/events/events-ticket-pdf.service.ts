import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { faTime } from '../common/persian.js';
import puppeteer, { type Browser } from 'puppeteer';
import QRCode from 'qrcode';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { formatJalaliDate } from '../common/persian.js';

function formatWhenFa(date: Date): string {
  const time = faTime(date);
  return `${formatJalaliDate(date)} ساعت ${time}`;
}

type TicketForPdf = {
  ticketCode: string;
  qrToken: string;
  attendeeName: string;
  ticketTypeName: string;
  event: { title: string; startAt: Date; venue: string | null; isOnline: boolean };
};

function buildHtml(ticket: TicketForPdf, orgName: string, qrDataUrl: string): string {
  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { padding: 28px; color: #0f172a; }
  .ticket { border: 2px solid #4f46e5; border-radius: 20px; overflow: hidden; max-width: 480px; margin: 0 auto; }
  .head { background: #4f46e5; color: #fff; padding: 24px; text-align: center; }
  .org { font-size: 13px; opacity: 0.85; margin-bottom: 6px; }
  .title { font-size: 20px; font-weight: 800; }
  .type { font-size: 13px; opacity: 0.9; margin-top: 4px; }
  .divider { border-top: 2px dashed #cbd5e1; margin: 0 24px; }
  .body { padding: 28px 24px; text-align: center; }
  .qr { width: 220px; height: 220px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px; background: #fff; }
  .code { font-size: 22px; font-weight: 800; letter-spacing: 4px; margin-top: 16px; direction: ltr; }
  .rows { margin-top: 22px; text-align: right; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .row span:first-child { color: #64748b; }
  .row span:last-child { font-weight: 700; }
</style>
</head>
<body>
  <div class="ticket">
    <div class="head">
      <div class="org">${escapeHtml(orgName)}</div>
      <div class="title">${escapeHtml(ticket.event.title)}</div>
      <div class="type">بلیط ${escapeHtml(ticket.ticketTypeName)}</div>
    </div>
    <div class="divider"></div>
    <div class="body">
      <img class="qr" src="${qrDataUrl}" />
      <div class="code">${escapeHtml(ticket.ticketCode)}</div>
      <div class="rows">
        <div class="row"><span>شرکت‌کننده</span><span>${escapeHtml(ticket.attendeeName)}</span></div>
        <div class="row"><span>زمان رویداد</span><span>${escapeHtml(formatWhenFa(ticket.event.startAt))}</span></div>
        ${ticket.event.venue ? `<div class="row"><span>مکان</span><span>${escapeHtml(ticket.event.venue)}</span></div>` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** بلیط PDF قابل چاپ/ارسال — همان الگوی Puppeteer مشترک با SalesInvoicePdfService، با QR واقعی (qrcode) داخل قالب. */
@Injectable()
export class EventsTicketPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('EventsTicketPdfService');
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

  async render(ticket: TicketForPdf, orgName: string): Promise<Buffer> {
    const qrDataUrl = await QRCode.toDataURL(ticket.qrToken, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(buildHtml(ticket, orgName, qrDataUrl), { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A5', printBackground: true, margin: { top: '10mm', bottom: '10mm', right: '8mm', left: '8mm' } });
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
