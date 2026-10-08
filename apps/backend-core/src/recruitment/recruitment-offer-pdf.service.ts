import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { formatJalaliDate, formatToman } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { hardenPage, safeImgSrc } from '../security/puppeteer-hardening.js';

type OfferForPdf = {
  applicantName: string;
  jobDescription: string;
  collaborationType: string;
  workingHours: string | null;
  salary: number;
  benefits: string | null;
  durationMonths: number | null;
  startDate: Date | null;
  signedAt: Date | null;
  signedByName: string | null;
  candidateSignature: string | null;
};

function buildHtml(offer: OfferForPdf, orgName: string, seal: { signatureImage?: string; stampImage?: string }): string {
  const rows: [string, string][] = [
    ['شرح وظایف', offer.jobDescription],
    ['نحوه‌ی همکاری', offer.collaborationType],
    ['ساعت حضور روزانه در محل شرکت', offer.workingHours ?? '—'],
    ['حقوق و دستمزد (ماهانه)', formatToman(offer.salary)],
    ['سایر تسهیلات', offer.benefits ?? '—'],
    ['مدت همکاری', offer.durationMonths ? `${offer.durationMonths} ماه` : 'نامحدود'],
    ['تاریخ شروع', offer.startDate ? formatJalaliDate(offer.startDate) : '—'],
  ];

  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { padding: 20mm; color: #0f172a; }
  .header { text-align: center; margin-bottom: 24px; }
  .org { font-size: 15px; font-weight: 800; }
  .title { font-size: 13px; color: #475569; margin-top: 4px; }
  .rows { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .row { display: flex; border-bottom: 1px solid #e2e8f0; }
  .row:last-child { border-bottom: none; }
  .row .label { width: 160px; padding: 10px 14px; background: #f8fafc; font-weight: 700; font-size: 12px; color: #475569; }
  .row .value { flex: 1; padding: 10px 14px; font-size: 12.5px; white-space: pre-wrap; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
  .sig-box { text-align: center; width: 45%; }
  .sig-box img { height: 60px; margin-bottom: 6px; }
  .sig-label { font-size: 12px; color: #475569; border-top: 1px solid #94a3b8; padding-top: 6px; margin-top: 4px; }
</style>
</head>
<body>
  <div class="header">
    <div class="org">${escapeHtml(orgName)}</div>
    <div class="title">شرایط همکاری — ${escapeHtml(offer.applicantName)}</div>
  </div>
  <div class="rows">
    ${rows.map(([label, value]) => `<div class="row"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join('')}
  </div>
  <div class="signatures">
    <div class="sig-box">
      ${offer.candidateSignature ? `<img src="${safeImgSrc(offer.candidateSignature)}" />` : ''}
      <div class="sig-label">امضای متقاضی — ${escapeHtml(offer.applicantName)}</div>
    </div>
    <div class="sig-box">
      ${seal.stampImage ? `<img src="${safeImgSrc(seal.stampImage)}" />` : ''}
      ${seal.signatureImage ? `<img src="${safeImgSrc(seal.signatureImage)}" />` : ''}
      <div class="sig-label">امضا و مهر شرکت${offer.signedByName ? ` — ${escapeHtml(offer.signedByName)}` : ''}${offer.signedAt ? ` — ${formatJalaliDate(offer.signedAt)}` : ''}</div>
    </div>
  </div>
</body>
</html>`;
}

/** پرینت PDF شرایط همکاری با مهر و امضای رسمی شرکت — همان الگوی ContractPdfService. */
@Injectable()
export class RecruitmentOfferPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('RecruitmentOfferPdfService');
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

  async render(offer: OfferForPdf, orgName: string, seal: { signatureImage?: string; stampImage?: string }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await hardenPage(page);
    try {
      await page.setContent(buildHtml(offer, orgName, seal), { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', right: '16mm', left: '16mm' } });
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
