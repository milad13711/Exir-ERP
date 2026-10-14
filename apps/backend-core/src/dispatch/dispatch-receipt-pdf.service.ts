import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { faDate, faTime } from '../common/persian.js';
import { hardenPage, safeImgSrc } from '../security/puppeteer-hardening.js';

export type ReceiptPdfData = {
  orgName: string;
  shipmentNo: number;
  cargoType: string;
  quantityText: string;
  region: string | null;
  customerName: string | null;
  postalAddress: string | null;
  postalCode: string | null;
  driverName: string | null;
  plateNumber: string | null;
  vehicleType: string | null;
  tareKg: number | null;
  grossKg: number | null;
  netKg: number | null;
  mode: 'SIGNED' | 'PAPER';
  signedAt: Date | null;
  signerName: string | null;
  signatureData: string | null;
  evidenceId: string | null;
  evidenceIp: string | null;
  evidenceTimeTehran: string | null;
  paperByName: string | null;
};

const kg = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fa-IR', { maximumFractionDigits: 3 })} کیلوگرم`);
const val = (s: string | null | undefined) => (s && s.trim() ? escapeHtml(s) : '—');

/** HTML رسید بار — فقط داده‌های فارسی/RTL و فونت جاسازی‌شده؛ همه‌ی مقادیر escape می‌شوند. صادرشده تا آزمون‌پذیر باشد. */
export function buildReceiptHtml(d: ReceiptPdfData): string {
  const sig = safeImgSrc(d.signatureData);
  const evidence =
    d.mode === 'SIGNED'
      ? `<div class="evidence">امضای الکترونیک در ${escapeHtml(d.evidenceTimeTehran ?? (d.signedAt ? `${faDate(d.signedAt)} ${faTime(d.signedAt)}` : '—'))} ثبت شد${
          d.evidenceIp ? ` — IP: <span dir="ltr">${escapeHtml(d.evidenceIp)}</span>` : ''
        }${d.evidenceId ? ` — شناسه‌ی مدرک: <span dir="ltr">${escapeHtml(d.evidenceId.slice(0, 8))}</span>` : ''}</div>`
      : `<div class="evidence">رسید کاغذیِ امضاشده توسط ${val(d.paperByName)} اسکن و در سامانه ثبت شد.</div>`;
  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  body { color: #0f172a; font-size: 12.5px; line-height: 1.9; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
  .title { font-size: 22px; font-weight: 800; }
  .org { font-size: 13px; color: #475569; }
  .no { font-size: 15px; font-weight: 800; }
  h3 { font-size: 13px; margin: 16px 0 6px; color: #334155; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid #cbd5e1; padding: 6px 10px; vertical-align: top; }
  td.k { width: 26%; background: #f1f5f9; color: #475569; font-weight: 600; }
  .weights td { text-align: center; font-weight: 800; font-size: 14px; }
  .weights td.k { font-size: 12px; font-weight: 600; }
  .stmt { margin-top: 16px; border: 1.5px solid #0f172a; border-radius: 10px; padding: 12px 14px; font-weight: 700; }
  .sig { margin-top: 14px; display: flex; gap: 20px; align-items: flex-end; }
  .sig .box { flex: 1; border: 1px solid #cbd5e1; border-radius: 10px; min-height: 120px; padding: 8px; text-align: center; }
  .sig img { max-width: 100%; max-height: 110px; }
  .sig .cap { font-size: 11px; color: #64748b; margin-top: 4px; }
  .evidence { margin-top: 10px; font-size: 11px; color: #475569; }
  .foot { margin-top: 18px; font-size: 10.5px; color: #94a3b8; text-align: center; }
</style></head>
<body>
  <div class="head">
    <div><div class="title">رسید بار</div><div class="org">${escapeHtml(d.orgName)}</div></div>
    <div class="no">شماره بار: ${escapeHtml(String(d.shipmentNo))}</div>
  </div>

  <h3>مشخصات بار</h3>
  <table>
    <tr><td class="k">نوع بار</td><td>${val(d.cargoType)}</td><td class="k">مقدار اعلامی</td><td>${val(d.quantityText)}</td></tr>
    <tr><td class="k">مشتری / گیرنده</td><td>${val(d.customerName)}</td><td class="k">منطقه</td><td>${val(d.region)}</td></tr>
    <tr><td class="k">آدرس پستی</td><td colspan="3">${val(d.postalAddress)}${d.postalCode ? ` — کد پستی: ${val(d.postalCode)}` : ''}</td></tr>
  </table>

  <h3>وزن‌ها</h3>
  <table class="weights">
    <tr><td class="k">وزن خالی</td><td>${kg(d.tareKg)}</td><td class="k">وزن پر</td><td>${kg(d.grossKg)}</td><td class="k">وزن خالص</td><td>${kg(d.netKg)}</td></tr>
  </table>

  <h3>راننده و وسیله‌ی نقلیه</h3>
  <table>
    <tr><td class="k">راننده</td><td>${val(d.driverName)}</td><td class="k">پلاک</td><td>${val(d.plateNumber)}</td></tr>
    <tr><td class="k">نوع وسیله</td><td colspan="3">${val(d.vehicleType)}</td></tr>
  </table>

  <div class="stmt">اینجانب ${val(d.signerName ?? d.driverName)}، بار فوق را صحیح و سالم تحویل گرفتم.</div>
  <div class="sig">
    <div class="box">${sig ? `<img src="${sig}" />` : '<div style="padding-top:44px;color:#94a3b8">رسید کاغذیِ ضمیمه‌شده</div>'}<div class="cap">امضای راننده</div></div>
  </div>
  ${evidence}
  <div class="foot">این سند به‌صورت خودکار از سامانه صادر شده است.</div>
</body></html>`;
}

@Injectable()
export class DispatchReceiptPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('DispatchReceiptPdfService');
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

  async render(data: ReceiptPdfData): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await hardenPage(page);
    try {
      await page.setContent(buildReceiptHtml(data), { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '14mm', right: '14mm', left: '14mm' } });
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
