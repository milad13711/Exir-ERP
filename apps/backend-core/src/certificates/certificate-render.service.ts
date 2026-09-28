import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import QRCode from 'qrcode';
import { formatJalaliDate, toPersianDigits } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { getDataUrlImageDimensions } from './image-dimensions.util.js';
import type { CertificateFieldKey, CertificateTemplateSettings, FieldPosition } from './certificate-template-settings.service.js';

export type CertificateLang = 'fa' | 'en';

export type CertificateItemForRender = { titleFa: string; titleEn: string | null };

export type CertificateForRender = {
  code: string;
  recipientNameFa: string;
  recipientNameEn: string | null;
  titleFa: string;
  titleEn: string | null;
  durationHours: number | null;
  startDate: Date | null;
  endDate: Date | null;
  score: number | null;
  issuedByName: string | null;
  createdAt: Date;
  items: CertificateItemForRender[];
};

export type SealImages = { signatureImage?: string | null; stampImage?: string | null };

const MM_PER_PX = 25.4 / 96;
const DEFAULT_ASPECT = 210 / 297; // A4 landscape height/width — used when there's no background image (or its size can't be read)

function pxFromMm(mm: number): number {
  return Math.round(mm / MM_PER_PX);
}

function enDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'Asia/Tehran' });
}

function localizeNumber(value: number, lang: CertificateLang): string {
  return lang === 'fa' ? toPersianDigits(value) : String(value);
}

function localizeCode(code: string, lang: CertificateLang): string {
  return lang === 'fa' ? toPersianDigits(code) : code;
}

function recipientName(cert: CertificateForRender, lang: CertificateLang): string {
  if (lang === 'en') return cert.recipientNameEn || cert.recipientNameFa;
  return cert.recipientNameFa;
}

function title(cert: CertificateForRender, lang: CertificateLang): string {
  if (lang === 'en') return cert.titleEn || cert.titleFa;
  return cert.titleFa;
}

function buildItemsText(cert: CertificateForRender, lang: CertificateLang): string {
  const sep = lang === 'en' ? ', ' : '، ';
  const names = cert.items.map((it) => (lang === 'en' ? it.titleEn || it.titleFa : it.titleFa));
  return names.join(sep);
}

function buildMetaText(cert: CertificateForRender, lang: CertificateLang): string {
  const parts: string[] = [];
  if (cert.durationHours) {
    parts.push(lang === 'en' ? `Duration: ${cert.durationHours}h` : `مدت: ${toPersianDigits(cert.durationHours)} ساعت`);
  }
  if (cert.startDate && cert.endDate) {
    parts.push(
      lang === 'en'
        ? `${enDate(cert.startDate)} – ${enDate(cert.endDate)}`
        : `از ${formatJalaliDate(cert.startDate)} تا ${formatJalaliDate(cert.endDate)}`,
    );
  }
  if (cert.score != null) {
    parts.push(lang === 'en' ? `Score: ${cert.score}/100` : `امتیاز: ${toPersianDigits(cert.score)} از ۱۰۰`);
  }
  return parts.join(lang === 'en' ? ' · ' : ' · ');
}

function fontFace(): string {
  return `@font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }`;
}

/** طرح ثابت طلایی قدیمی — وقتی تننت هنوز تصویر پس‌زمینه‌ی سفارشی برای قالب گواهی تنظیم نکرده است. */
function buildFixedLayoutHtml(
  cert: CertificateForRender,
  lang: CertificateLang,
  orgName: string,
  qrDataUrl: string,
  seal: SealImages,
  widthMm: number,
  heightMm: number,
): string {
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const items = buildItemsText(cert, lang);
  const meta = buildMetaText(cert, lang);
  const issuedAt = lang === 'fa' ? formatJalaliDate(cert.createdAt) : enDate(cert.createdAt);

  const strings =
    lang === 'fa'
      ? {
          badge: 'گواهی‌نامه',
          intro: 'این گواهی تأیید می‌کند که فرد فوق موارد زیر را با موفقیت گذرانده است',
          sigLabel: 'مهر و امضای مدیریت',
          issuedBy: cert.issuedByName ? `صادرکننده: ${cert.issuedByName}` : '',
        }
      : {
          badge: 'Certificate of Completion',
          intro: 'This certifies that the above person has successfully completed the following',
          sigLabel: 'Company stamp & signature',
          issuedBy: cert.issuedByName ? `Issued by: ${cert.issuedByName}` : '',
        };

  return `<!doctype html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  html, body { width: ${widthMm}mm; height: ${heightMm}mm; }
  body { background: #fdfbf5; padding: 10mm; }
  .frame { width: 100%; height: 100%; border: 2mm solid #8a6d1f; border-radius: 3mm; padding: 8mm 14mm; position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .frame::before { content: ""; position: absolute; inset: 4mm; border: 0.5mm solid #c9a94a; border-radius: 2mm; }
  .org { font-size: 4mm; color: #6b5518; letter-spacing: 0.3mm; margin-top: 2mm; }
  .badge { font-size: 8mm; font-weight: 800; color: #8a6d1f; margin-top: 7mm; }
  .divider { width: 30mm; height: 0.5mm; background: #c9a94a; margin: 6mm 0; }
  .recipient { font-size: 9mm; font-weight: 800; color: #1f2937; }
  .recipient-en { font-size: 4.5mm; color: #6b7280; margin-top: 1mm; }
  .intro { font-size: 3.6mm; color: #4b5563; margin-top: 6mm; }
  .course { font-size: 5.5mm; font-weight: 700; color: #1f2937; margin-top: 2mm; }
  .items { font-size: 3.6mm; color: #374151; margin-top: 3mm; max-width: 85%; line-height: 1.7; }
  .meta { font-size: 3.3mm; color: #4b5563; margin-top: 4mm; }
  .issuedBy { font-size: 3mm; color: #6b7280; margin-top: 2mm; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: auto; }
  .sig { text-align: center; width: 55mm; }
  .sig img { height: 14mm; }
  .sig-label { font-size: 3mm; color: #6b7280; border-top: 0.3mm solid #c9a94a; padding-top: 1.5mm; margin-top: 1mm; }
  .qr-box { text-align: center; }
  .qr-box img { width: 22mm; height: 22mm; }
  .code { font-size: 2.8mm; color: #6b7280; letter-spacing: 0.5mm; margin-top: 1mm; direction: ltr; }
</style>
</head>
<body>
  <div class="frame">
    <div class="org">${escapeHtml(orgName)}</div>
    <div class="badge">${strings.badge}</div>
    <div class="divider"></div>
    <div class="recipient">${escapeHtml(recipientName(cert, lang))}</div>
    <div class="intro">${strings.intro}</div>
    <div class="course">${escapeHtml(title(cert, lang))}</div>
    ${items ? `<div class="items">${escapeHtml(items)}</div>` : ''}
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    <div class="footer">
      <div class="qr-box">
        <img src="${qrDataUrl}" />
        <div class="code">${localizeCode(cert.code, lang)}</div>
        <div class="code">${issuedAt}</div>
      </div>
      <div class="sig">
        ${seal.stampImage ? `<img src="${seal.stampImage}" />` : ''}
        ${seal.signatureImage ? `<img src="${seal.signatureImage}" />` : ''}
        <div class="sig-label">${strings.sigLabel}</div>
        ${strings.issuedBy ? `<div class="issuedBy">${escapeHtml(strings.issuedBy)}</div>` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function fieldStyle(pos: FieldPosition, extra = ''): string {
  const align = pos.align ?? 'center';
  const translateX = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0%';
  const width = pos.widthPct ? `width: ${pos.widthPct}%;` : '';
  const fontSize = pos.fontSizePx ? `font-size: ${pos.fontSizePx}px;` : '';
  const lineHeight = pos.lineHeightPx ? `line-height: ${pos.lineHeightPx}px;` : '';
  return `position: absolute; left: ${pos.xPct}%; top: ${pos.yPct}%; transform: translate(${translateX}, -50%); text-align: ${align}; ${width} ${fontSize} ${lineHeight} ${extra}`;
}

/** قالب قابل‌تنظیم — تصویر پس‌زمینه‌ی تننت + مختصات درصدی هر فیلد که در تنظیمات قالب ذخیره شده است. */
function buildTemplateHtml(
  cert: CertificateForRender,
  lang: CertificateLang,
  settings: CertificateTemplateSettings,
  qrDataUrl: string,
  seal: SealImages,
  widthMm: number,
  heightMm: number,
): string {
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const fields = lang === 'fa' ? settings.fieldsFa : settings.fieldsEn;
  const items = buildItemsText(cert, lang);
  const meta = buildMetaText(cert, lang);
  const issuedAt = lang === 'fa' ? formatJalaliDate(cert.createdAt) : enDate(cert.createdAt);
  const get = (key: CertificateFieldKey): FieldPosition => fields[key];

  const nodes: string[] = [];
  nodes.push(`<div style="${fieldStyle(get('recipientName'))} color:#1f2937; font-weight:800;">${escapeHtml(recipientName(cert, lang))}</div>`);
  nodes.push(`<div style="${fieldStyle(get('title'))} color:#1f2937; font-weight:700;">${escapeHtml(title(cert, lang))}</div>`);
  if (items || meta) {
    const itemsBody = [items, meta].filter(Boolean).join(lang === 'en' ? ' — ' : ' — ');
    nodes.push(`<div style="${fieldStyle(get('items'))} color:#374151;">${escapeHtml(itemsBody)}</div>`);
  }
  nodes.push(`<div style="${fieldStyle(get('code'))} color:#6b7280; direction:ltr;">${localizeCode(cert.code, lang)}</div>`);
  nodes.push(`<div style="${fieldStyle(get('issueDate'))} color:#6b7280;">${issuedAt}</div>`);
  const qrPos = get('qr');
  nodes.push(`<img src="${qrDataUrl}" style="${fieldStyle(qrPos, 'height:auto;')}" />`);
  if (seal.stampImage) {
    const stampPos = get('stamp');
    nodes.push(`<img src="${seal.stampImage}" style="${fieldStyle(stampPos, 'height:auto;')}" />`);
  }
  if (seal.signatureImage) {
    const sigPos = get('signature');
    nodes.push(`<img src="${seal.signatureImage}" style="${fieldStyle(sigPos, 'height:auto;')}" />`);
  }

  return `<!doctype html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Vazirmatn', sans-serif; }
  html, body { width: ${widthMm}mm; height: ${heightMm}mm; }
  .canvas { position: relative; width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; background: #fff; }
  .canvas > img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .canvas div, .canvas img:not(.bg) { font-size: 14px; }
</style>
</head>
<body>
  <div class="canvas">
    <img class="bg" src="${settings.backgroundImage}" />
    ${nodes.join('\n    ')}
  </div>
</body>
</html>`;
}

/**
 * رندر گواهی به PNG/PDF — همان الگوی سایر سرویس‌های Puppeteer این پروژه
 * (مرورگر مشترک تنبل‌ساخته‌شده، هر رندر یک صفحه‌ی جدید). اگر تننت تصویر
 * پس‌زمینه‌ی قالب را تنظیم نکرده باشد، طرح ثابت طلایی قدیمی رندر می‌شود تا
 * هیچ تننتی با این تغییر گواهی خالی/شکسته نبیند.
 */
@Injectable()
export class CertificateRenderService implements OnModuleDestroy {
  private readonly logger = new Logger('CertificateRenderService');
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

  private async buildHtmlAndSize(
    cert: CertificateForRender,
    lang: CertificateLang,
    orgName: string,
    verifyUrl: string,
    settings: CertificateTemplateSettings,
    seal: SealImages,
  ): Promise<{ html: string; widthMm: number; heightMm: number }> {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
    const widthMm = 297;
    let aspect = DEFAULT_ASPECT; // height/width

    if (settings.backgroundImage) {
      const dims = getDataUrlImageDimensions(settings.backgroundImage);
      if (dims) aspect = dims.height / dims.width;
    }
    const heightMm = Math.round(widthMm * aspect * 100) / 100;

    const effectiveSeal: SealImages = {
      stampImage: settings.stampImage ?? seal.stampImage,
      signatureImage: settings.signatureImage ?? seal.signatureImage,
    };

    const html = settings.backgroundImage
      ? buildTemplateHtml(cert, lang, settings, qrDataUrl, effectiveSeal, widthMm, heightMm)
      : buildFixedLayoutHtml(cert, lang, orgName, qrDataUrl, effectiveSeal, widthMm, heightMm);

    return { html, widthMm, heightMm };
  }

  async renderPng(
    cert: CertificateForRender,
    lang: CertificateLang,
    orgName: string,
    verifyUrl: string,
    settings: CertificateTemplateSettings,
    seal: SealImages,
  ): Promise<Buffer> {
    const { html, widthMm, heightMm } = await this.buildHtmlAndSize(cert, lang, orgName, verifyUrl, settings, seal);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: pxFromMm(widthMm), height: pxFromMm(heightMm) });
      await page.setContent(html, { waitUntil: 'load' });
      const png = await page.screenshot({ type: 'png' });
      return Buffer.from(png);
    } finally {
      await page.close();
    }
  }

  async renderPdf(
    cert: CertificateForRender,
    lang: CertificateLang,
    orgName: string,
    verifyUrl: string,
    settings: CertificateTemplateSettings,
    seal: SealImages,
  ): Promise<Buffer> {
    const { html, widthMm, heightMm } = await this.buildHtmlAndSize(cert, lang, orgName, verifyUrl, settings, seal);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        printBackground: true,
        margin: { top: '0mm', bottom: '0mm', right: '0mm', left: '0mm' },
      });
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
