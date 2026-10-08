import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { formatJalaliDate, formatToman } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { hardenPage, safeImgSrc } from '../security/puppeteer-hardening.js';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  CONFIRMED: 'تأییدشده',
  PARTIALLY_PAID: 'پرداخت جزئی',
  PAID: 'پرداخت‌شده',
  CANCELLED: 'باطل‌شده',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'کارت/حساب بانکی',
  ONLINE_GATEWAY: 'درگاه پرداخت آنلاین',
  CASH: 'نقدی',
  CHECK: 'چکی',
};

type InvoiceForPdf = {
  invoiceNo: number;
  officialInvoiceNo: number | null;
  status: string;
  issuedAt: Date;
  dueAt: Date | null;
  subtotal: number;
  discount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  paidAmount: number;
  notes: string | null;
  isOfficial: boolean;
  signedByName: string | null;
  signatureDataUrl: string | null;
  signedAt: Date | null;
  deliveryConfirmedName: string | null;
  deliverySignatureDataUrl: string | null;
  deliveryConfirmedAt: Date | null;
  paymentMethod: string;
  paymentBankInfo: string | null;
  checks: Array<{ sayadId: string; amount: number; dueDate: Date; bankName: string | null }>;
  contact: {
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    type: string;
    address: string | null;
    nationalId: string | null;
    economicCode: string | null;
    legalId: string | null;
    registrationNumber: string | null;
  };
  lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
};

type SellerInfo = {
  orgName: string;
  address: string | null;
  phone: string | null;
  economicCode: string | null;
  nationalId: string | null;
  registrationNumber: string | null;
};

/** Renders a tenant's own sales invoice to their customer — same rendering approach as InvoicePdfService (billing), separate service since it's tenant-scoped and needs no cross-database access. */
@Injectable()
export class SalesInvoicePdfService implements OnModuleDestroy {
  private readonly logger = new Logger('SalesInvoicePdfService');
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

  async render(invoice: InvoiceForPdf, seller: SellerInfo): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await hardenPage(page);
    try {
      await page.setContent(buildHtml(invoice, seller), { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', bottom: '18mm', right: '16mm', left: '16mm' },
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

function buildHtml(invoice: InvoiceForPdf, seller: SellerInfo): string {
  const remaining = invoice.total - invoice.paidAmount;
  return /* html */ `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Vazirmatn';
    src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2');
    font-weight: 100 900;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Vazirmatn', Tahoma, sans-serif; margin: 0; color: #1c2333; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 18px; font-weight: 800; color: #4f46e5; }
  .brand-sub { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.9; }
  .invoice-meta { text-align: left; font-size: 12px; color: #475569; line-height: 1.9; }
  .invoice-meta b { color: #1c2333; }
  .status { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 8px; margin-top: 6px; }
  .status.PAID { background: #dcfce7; color: #16a34a; }
  .status.CONFIRMED, .status.PARTIALLY_PAID { background: #fef3c7; color: #b45309; }
  .status.DRAFT { background: #f1f5f9; color: #64748b; }
  .status.CANCELLED { background: #fee2e2; color: #dc2626; }
  .section-title { font-size: 12px; font-weight: 700; color: #64748b; margin: 24px 0 8px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: right; padding: 10px 12px; font-size: 12.5px; }
  thead th { background: #f1f5f9; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
  tbody td { border-bottom: 1px solid #f1f5f9; }
  .totals td { padding: 6px 12px; border: none; }
  .totals .final td { font-weight: 800; font-size: 15px; padding-top: 12px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; }
  .signatures { display: flex; gap: 16px; margin-top: 32px; }
  .sig-box { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .sig-box .sig-title { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
  .sig-box img { max-height: 60px; max-width: 100%; }
  .sig-box .sig-name { font-size: 12.5px; font-weight: 700; margin-top: 6px; }
  .sig-box .sig-date { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
  .official-badge { display: inline-block; font-size: 10.5px; font-weight: 700; color: #4f46e5; margin-right: 8px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(seller.orgName)}</div>
      <div class="brand-sub">
        ${seller.address ? `آدرس: ${escapeHtml(seller.address)}<br/>` : ''}
        ${seller.phone ? `تلفن: ${escapeHtml(seller.phone)}<br/>` : ''}
        ${seller.economicCode ? `کد اقتصادی: ${escapeHtml(seller.economicCode)}<br/>` : ''}
        ${seller.nationalId ? `شناسه ملی: ${escapeHtml(seller.nationalId)}` : ''}
      </div>
    </div>
    <div class="invoice-meta">
      <div><b>شماره فاکتور:</b> ${invoice.isOfficial && invoice.officialInvoiceNo ? invoice.officialInvoiceNo : invoice.invoiceNo}</div>
      <div><b>تاریخ صدور:</b> ${formatJalaliDate(invoice.issuedAt)}</div>
      ${invoice.dueAt ? `<div><b>مهلت پرداخت:</b> ${formatJalaliDate(invoice.dueAt)}</div>` : ''}
      <div class="status ${invoice.status}">${STATUS_LABELS[invoice.status] ?? invoice.status}</div>
      ${invoice.isOfficial ? `<div class="official-badge">فاکتور رسمی</div>` : ''}
    </div>
  </div>

  <div class="section-title">صورتحساب برای</div>
  <div class="box">
    <div style="font-weight: 700; font-size: 14px;">${escapeHtml(invoice.contact.company || invoice.contact.name)}</div>
    ${invoice.contact.company ? `<div style="color: #64748b; margin-top: 2px;">${escapeHtml(invoice.contact.name)}</div>` : ''}
    ${invoice.contact.phone ? `<div style="color: #64748b; margin-top: 4px;" dir="ltr">${escapeHtml(invoice.contact.phone)}</div>` : ''}
    ${invoice.contact.address ? `<div style="color: #64748b; margin-top: 4px;">آدرس: ${escapeHtml(invoice.contact.address)}</div>` : ''}
    ${
      invoice.isOfficial
        ? invoice.contact.type === 'COMPANY'
          ? `
      ${invoice.contact.economicCode ? `<div style="color: #64748b; margin-top: 4px;">کد اقتصادی: ${escapeHtml(invoice.contact.economicCode)}</div>` : ''}
      ${invoice.contact.legalId ? `<div style="color: #64748b; margin-top: 4px;">شناسه ملی: ${escapeHtml(invoice.contact.legalId)}</div>` : ''}
      ${invoice.contact.registrationNumber ? `<div style="color: #64748b; margin-top: 4px;">شماره ثبت: ${escapeHtml(invoice.contact.registrationNumber)}</div>` : ''}
      `
          : invoice.contact.nationalId
            ? `<div style="color: #64748b; margin-top: 4px;">کد ملی: ${escapeHtml(invoice.contact.nationalId)}</div>`
            : ''
        : ''
    }
  </div>

  <table>
    <thead>
      <tr><th>شرح</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ</th></tr>
    </thead>
    <tbody>
      ${invoice.lines
        .map(
          (l) => `<tr>
            <td>${escapeHtml(l.description)}</td>
            <td>${l.quantity}</td>
            <td>${formatToman(l.unitPrice)}</td>
            <td>${formatToman(l.lineTotal)}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <table class="totals">
    <tr><td colspan="3" style="text-align: left;">جمع اقلام</td><td>${formatToman(invoice.subtotal)}</td></tr>
    ${invoice.discount > 0 ? `<tr><td colspan="3" style="text-align: left;">تخفیف</td><td>-${formatToman(invoice.discount)}</td></tr>` : ''}
    ${invoice.taxAmount > 0 ? `<tr><td colspan="3" style="text-align: left;">مالیات بر ارزش افزوده${invoice.taxRate ? ` (${invoice.taxRate}٪)` : ''}</td><td>${formatToman(invoice.taxAmount)}</td></tr>` : ''}
    <tr class="final"><td colspan="3" style="text-align: left;">مبلغ نهایی</td><td>${formatToman(invoice.total)}</td></tr>
    ${invoice.paidAmount > 0 ? `<tr><td colspan="3" style="text-align: left;">پرداخت‌شده</td><td>${formatToman(invoice.paidAmount)}</td></tr>` : ''}
    ${remaining > 0 && invoice.paidAmount > 0 ? `<tr><td colspan="3" style="text-align: left;">باقی‌مانده</td><td>${formatToman(remaining)}</td></tr>` : ''}
  </table>

  <div class="section-title">روش پرداخت</div>
  <div class="box">
    <div style="font-weight: 700;">${escapeHtml(PAYMENT_METHOD_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod)}</div>
    ${
      invoice.paymentMethod === 'BANK_TRANSFER' && invoice.paymentBankInfo
        ? `<div style="color: #64748b; margin-top: 4px;" dir="ltr">${escapeHtml(invoice.paymentBankInfo)}</div>`
        : ''
    }
    ${
      invoice.paymentMethod === 'CHECK'
        ? invoice.checks.length > 0
          ? invoice.checks
              .map(
                (c) =>
                  `<div style="color: #64748b; margin-top: 4px;">شماره صیادی: <span dir="ltr">${escapeHtml(c.sayadId)}</span> — سررسید: ${formatJalaliDate(c.dueDate)} — مبلغ: ${formatToman(c.amount)}${c.bankName ? ` — بانک: ${escapeHtml(c.bankName)}` : ''}</div>`,
              )
              .join('')
          : `<div style="color: #64748b; margin-top: 4px;">چک هنوز نزد فروشنده ثبت نشده است.</div>`
        : ''
    }
  </div>

  ${invoice.notes ? `<div class="section-title">یادداشت</div><div class="box">${escapeHtml(invoice.notes)}</div>` : ''}

  ${
    invoice.signatureDataUrl || invoice.deliverySignatureDataUrl || invoice.deliveryConfirmedName
      ? `<div class="signatures">
    ${
      invoice.signatureDataUrl
        ? `<div class="sig-box">
      <div class="sig-title">امضای فروشنده</div>
      <img src="${safeImgSrc(invoice.signatureDataUrl)}" />
      <div class="sig-name">${escapeHtml(invoice.signedByName ?? '')}</div>
      ${invoice.signedAt ? `<div class="sig-date">${formatJalaliDate(invoice.signedAt)}</div>` : ''}
    </div>`
        : ''
    }
    ${
      invoice.deliveryConfirmedName
        ? `<div class="sig-box">
      <div class="sig-title">تأیید دریافت توسط مشتری</div>
      ${invoice.deliverySignatureDataUrl ? `<img src="${safeImgSrc(invoice.deliverySignatureDataUrl)}" />` : ''}
      <div class="sig-name">${escapeHtml(invoice.deliveryConfirmedName)}</div>
      ${invoice.deliveryConfirmedAt ? `<div class="sig-date">${formatJalaliDate(invoice.deliveryConfirmedAt)}</div>` : ''}
    </div>`
        : ''
    }
  </div>`
      : ''
  }

  <div class="footer">این سند به‌صورت خودکار توسط ${escapeHtml(seller.orgName)} صادر شده است.</div>
</body>
</html>`;
}
