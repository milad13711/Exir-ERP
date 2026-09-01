import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { formatJalaliDate, formatJalaliFull, formatToman } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { Invoice, Tenant, Plan } from '../../generated/control-client/index.js';

const GENERAL_SETTINGS_MODULE = 'general';

type TenantBillingInfo = {
  address: string | null;
  economicCode: string | null;
  nationalId: string | null;
  registrationNumber: string | null;
  phone: string | null;
};

const STATUS_LABELS: Record<Invoice['status'], string> = {
  PENDING: 'در انتظار پرداخت',
  PAID: 'پرداخت‌شده',
  FAILED: 'ناموفق',
};

/**
 * Renders an invoice as a print-ready PDF via headless Chromium, using the
 * same self-hosted Vazirmatn font as the rest of the app (embedded as a
 * data URI, so this works fully offline — no font CDN at request time).
 * The browser instance is kept warm across requests (launching Chromium
 * takes ~1s) and only torn down on module shutdown.
 */
@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private readonly logger = new Logger('InvoicePdfService');
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

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

  /** The tenant's own legal/contact details, entered at Settings → General — shown on their invoice as the billed party. */
  private async getTenantBillingInfo(tenant: Tenant): Promise<TenantBillingInfo> {
    try {
      const tenantDb = this.tenantPrisma.forTenant({
        dbHost: tenant.dbHost,
        dbPort: tenant.dbPort,
        dbName: tenant.dbName,
      });
      const rows = await tenantDb.moduleSetting.findMany({ where: { moduleCode: GENERAL_SETTINGS_MODULE } });
      const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value as string]));
      return {
        address: byKey.address ?? null,
        economicCode: byKey.economicCode ?? null,
        nationalId: byKey.nationalId ?? null,
        registrationNumber: byKey.registrationNumber ?? null,
        phone: byKey.phone ?? null,
      };
    } catch (err) {
      this.logger.warn(`Could not load tenant billing info for ${tenant.slug}: ${err instanceof Error ? err.message : err}`);
      return { address: null, economicCode: null, nationalId: null, registrationNumber: null, phone: null };
    }
  }

  async renderInvoicePdf(invoice: Invoice, tenant: Tenant, plan: Plan | null): Promise<Buffer> {
    const billingInfo = await this.getTenantBillingInfo(tenant);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(buildInvoiceHtml(invoice, tenant, plan, billingInfo), { waitUntil: 'load' });
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

function buildInvoiceHtml(invoice: Invoice, tenant: Tenant, plan: Plan | null, billingInfo: TenantBillingInfo): string {
  const invoiceNo = invoice.id.slice(0, 8).toUpperCase();
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
  body {
    font-family: 'Vazirmatn', Tahoma, sans-serif;
    margin: 0;
    color: #1c2333;
    font-size: 13px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #4f46e5;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .brand { font-size: 20px; font-weight: 800; color: #4f46e5; }
  .brand-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
  .invoice-meta { text-align: left; font-size: 12px; color: #475569; line-height: 1.9; }
  .invoice-meta b { color: #1c2333; }
  .status {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 8px;
    margin-top: 6px;
  }
  .status.PAID { background: #dcfce7; color: #16a34a; }
  .status.PENDING { background: #fef3c7; color: #b45309; }
  .status.FAILED { background: #fee2e2; color: #dc2626; }
  .section-title { font-size: 12px; font-weight: 700; color: #64748b; margin: 24px 0 8px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: right; padding: 10px 12px; font-size: 12.5px; }
  thead th { background: #f1f5f9; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
  tbody td { border-bottom: 1px solid #f1f5f9; }
  .amount-row td { font-weight: 800; font-size: 15px; padding-top: 16px; border: none; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">اکسیر ERP</div>
      <div class="brand-sub">صورتحساب / پیش‌فاکتور</div>
    </div>
    <div class="invoice-meta">
      <div><b>شماره فاکتور:</b> ${invoiceNo}</div>
      <div><b>تاریخ صدور:</b> ${formatJalaliDate(invoice.issuedAt)}</div>
      <div><b>مهلت پرداخت:</b> ${formatJalaliDate(invoice.dueAt)}</div>
      <div class="status ${invoice.status}">${STATUS_LABELS[invoice.status]}</div>
    </div>
  </div>

  <div class="section-title">صورتحساب برای</div>
  <div class="box">
    <div style="font-weight: 700; font-size: 14px;">${escapeHtml(tenant.name)}</div>
    <div style="color: #64748b; margin-top: 4px; direction: ltr; text-align: right;">${escapeHtml(tenant.slug)}</div>
    ${
      billingInfo.address || billingInfo.economicCode || billingInfo.nationalId || billingInfo.registrationNumber || billingInfo.phone
        ? `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #475569; line-height: 1.9;">
            ${billingInfo.address ? `<div>آدرس: ${escapeHtml(billingInfo.address)}</div>` : ''}
            ${billingInfo.phone ? `<div>تلفن: ${escapeHtml(billingInfo.phone)}</div>` : ''}
            ${billingInfo.economicCode ? `<div>کد اقتصادی: ${escapeHtml(billingInfo.economicCode)}</div>` : ''}
            ${billingInfo.nationalId ? `<div>شناسه ملی: ${escapeHtml(billingInfo.nationalId)}</div>` : ''}
            ${billingInfo.registrationNumber ? `<div>شماره ثبت: ${escapeHtml(billingInfo.registrationNumber)}</div>` : ''}
          </div>`
        : ''
    }
  </div>

  <table>
    <thead>
      <tr>
        <th>شرح</th>
        <th>مبلغ (تومان)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${plan ? `اشتراک پلن «${escapeHtml(plan.name)}»` : 'صورتحساب اکسیر ERP'}</td>
        <td>${formatToman(invoice.amount)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="amount-row">
        <td>مبلغ نهایی</td>
        <td>${formatToman(invoice.amount)}</td>
      </tr>
    </tfoot>
  </table>

  ${invoice.paidAt ? `<div class="section-title">پرداخت</div><div class="box">این فاکتور در تاریخ ${formatJalaliFull(invoice.paidAt)} پرداخت شده است.</div>` : ''}

  <div class="footer">این سند به‌صورت خودکار توسط اکسیر ERP صادر شده است.</div>
</body>
</html>`;
}
