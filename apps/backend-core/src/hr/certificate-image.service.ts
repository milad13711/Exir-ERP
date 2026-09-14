import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import QRCode from 'qrcode';
import { formatJalaliDate } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';

type CertificateForImage = {
  code: string;
  recipientNameFa: string;
  recipientNameEn: string | null;
  courseTitleFa: string;
  courseTitleEn: string | null;
  durationHours: number | null;
  startDate: Date | null;
  endDate: Date | null;
  score: number | null;
};

function buildHtml(
  cert: CertificateForImage,
  orgName: string,
  qrDataUrl: string,
  seal: { signatureImage?: string; stampImage?: string },
): string {
  const period =
    cert.startDate && cert.endDate ? `از ${formatJalaliDate(cert.startDate)} تا ${formatJalaliDate(cert.endDate)}` : '';

  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { width: 1200px; height: 850px; background: #fdfbf5; padding: 28px; }
  .frame { width: 100%; height: 100%; border: 6px solid #8a6d1f; border-radius: 10px; padding: 36px 56px; position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .frame::before { content: ""; position: absolute; inset: 14px; border: 1.5px solid #c9a94a; border-radius: 6px; }
  .org { font-size: 15px; color: #6b5518; letter-spacing: 1px; margin-top: 6px; }
  .badge { font-size: 30px; font-weight: 800; color: #8a6d1f; margin-top: 26px; }
  .badge-en { font-size: 14px; color: #a08a3f; letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
  .divider { width: 120px; height: 2px; background: #c9a94a; margin: 22px 0; }
  .recipient { font-size: 34px; font-weight: 800; color: #1f2937; }
  .recipient-en { font-size: 17px; color: #6b7280; margin-top: 4px; }
  .intro { font-size: 14px; color: #4b5563; margin-top: 22px; }
  .course { font-size: 22px; font-weight: 700; color: #1f2937; margin-top: 6px; }
  .course-en { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .meta { display: flex; gap: 34px; margin-top: 18px; font-size: 12.5px; color: #4b5563; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: auto; }
  .sig { text-align: center; width: 220px; }
  .sig img { height: 54px; }
  .sig-label { font-size: 11.5px; color: #6b7280; border-top: 1px solid #c9a94a; padding-top: 6px; margin-top: 4px; }
  .qr-box { text-align: center; }
  .qr-box img { width: 90px; height: 90px; }
  .code { font-size: 11px; color: #6b7280; letter-spacing: 2px; margin-top: 4px; direction: ltr; }
</style>
</head>
<body>
  <div class="frame">
    <div class="org">${escapeHtml(orgName)}</div>
    <div class="badge">گواهی‌نامه</div>
    <div class="badge-en">Certificate of Completion</div>
    <div class="divider"></div>
    <div class="recipient">${escapeHtml(cert.recipientNameFa)}</div>
    ${cert.recipientNameEn ? `<div class="recipient-en">${escapeHtml(cert.recipientNameEn)}</div>` : ''}
    <div class="intro">این گواهی تأیید می‌کند که فرد فوق دوره‌ی زیر را با موفقیت گذرانده است</div>
    <div class="course">${escapeHtml(cert.courseTitleFa)}</div>
    ${cert.courseTitleEn ? `<div class="course-en">${escapeHtml(cert.courseTitleEn)}</div>` : ''}
    <div class="meta">
      ${cert.durationHours ? `<span>مدت: ${cert.durationHours} ساعت</span>` : ''}
      ${period ? `<span>${period}</span>` : ''}
      ${cert.score != null ? `<span>امتیاز: ${cert.score} از ۱۰۰</span>` : ''}
    </div>
    <div class="footer">
      <div class="qr-box">
        <img src="${qrDataUrl}" />
        <div class="code">${escapeHtml(cert.code)}</div>
      </div>
      <div class="sig">
        ${seal.stampImage ? `<img src="${seal.stampImage}" />` : ''}
        ${seal.signatureImage ? `<img src="${seal.signatureImage}" />` : ''}
        <div class="sig-label">مهر و امضای مدیریت</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** رندر تصویر گواهی — همان الگوی EventsPosterService (page.screenshot به‌جای PDF، چون خروجی مدنظر «تصویر» است). */
@Injectable()
export class CertificateImageService implements OnModuleDestroy {
  private readonly logger = new Logger('CertificateImageService');
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

  async render(cert: CertificateForImage, orgName: string, verifyUrl: string, seal: { signatureImage?: string; stampImage?: string }): Promise<Buffer> {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 850 });
      await page.setContent(buildHtml(cert, orgName, qrDataUrl, seal), { waitUntil: 'load' });
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
