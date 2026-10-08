import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { formatToman } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { hardenPage } from '../security/puppeteer-hardening.js';

const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  ISSUED: 'صادرشده',
  PAID: 'پرداخت‌شده',
};

type PayrollSlipForPdf = {
  periodYear: number;
  periodMonth: number;
  baseSalary: number;
  allowances: number;
  deductions: number;
  insuranceAmount: number;
  taxAmount: number;
  status: string;
  issuedAt: Date | null;
  paidAt: Date | null;
  employee: {
    fullName: string;
    employeeCode: string;
    position: string;
  };
};

type EmployerInfo = {
  orgName: string;
  economicCode: string | null;
  nationalId: string | null;
};

/** Renders one employee's payroll slip to PDF — same rendering approach as SalesInvoicePdfService. */
@Injectable()
export class PayrollPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('PayrollPdfService');
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

  async render(slip: PayrollSlipForPdf, employer: EmployerInfo): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await hardenPage(page);
    try {
      await page.setContent(buildHtml(slip, employer), { waitUntil: 'load' });
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

function buildHtml(slip: PayrollSlipForPdf, employer: EmployerInfo): string {
  const gross = slip.baseSalary + slip.allowances;
  const totalDeductions = slip.deductions + slip.insuranceAmount + slip.taxAmount;
  const net = gross - totalDeductions;
  const periodLabel = `${JALALI_MONTH_NAMES[slip.periodMonth - 1] ?? slip.periodMonth} ${slip.periodYear}`;

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
  .meta { text-align: left; font-size: 12px; color: #475569; line-height: 1.9; }
  .meta b { color: #1c2333; }
  .status { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 8px; margin-top: 6px; }
  .status.PAID { background: #dcfce7; color: #16a34a; }
  .status.ISSUED { background: #fef3c7; color: #b45309; }
  .status.DRAFT { background: #f1f5f9; color: #64748b; }
  .section-title { font-size: 12px; font-weight: 700; color: #64748b; margin: 24px 0 8px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: right; padding: 10px 12px; font-size: 12.5px; }
  thead th { background: #f1f5f9; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
  tbody td { border-bottom: 1px solid #f1f5f9; }
  .totals td { padding: 6px 12px; border: none; }
  .totals .final td { font-weight: 800; font-size: 15px; padding-top: 12px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(employer.orgName)}</div>
      <div class="brand-sub">
        ${employer.economicCode ? `کد اقتصادی: ${escapeHtml(employer.economicCode)}<br/>` : ''}
        ${employer.nationalId ? `شناسه ملی: ${escapeHtml(employer.nationalId)}` : ''}
      </div>
    </div>
    <div class="meta">
      <div><b>فیش حقوقی</b></div>
      <div><b>دوره:</b> ${periodLabel}</div>
      <div class="status ${slip.status}">${STATUS_LABELS[slip.status] ?? slip.status}</div>
    </div>
  </div>

  <div class="section-title">مشخصات پرسنل</div>
  <div class="box">
    <div style="font-weight: 700; font-size: 14px;">${escapeHtml(slip.employee.fullName)}</div>
    <div style="color: #64748b; margin-top: 4px;">کد پرسنلی: ${escapeHtml(slip.employee.employeeCode)}</div>
    <div style="color: #64748b; margin-top: 4px;">سمت: ${escapeHtml(slip.employee.position)}</div>
  </div>

  <table>
    <thead>
      <tr><th>شرح</th><th>مبلغ (تومان)</th></tr>
    </thead>
    <tbody>
      <tr><td>حقوق پایه</td><td>${formatToman(slip.baseSalary)}</td></tr>
      ${slip.allowances > 0 ? `<tr><td>مزایا</td><td>${formatToman(slip.allowances)}</td></tr>` : ''}
      <tr><td>بیمه سهم کارمند</td><td>-${formatToman(slip.insuranceAmount)}</td></tr>
      <tr><td>مالیات حقوق</td><td>-${formatToman(slip.taxAmount)}</td></tr>
      ${slip.deductions > 0 ? `<tr><td>سایر کسورات</td><td>-${formatToman(slip.deductions)}</td></tr>` : ''}
    </tbody>
  </table>

  <table class="totals">
    <tr><td style="text-align: left;">ناخالص</td><td>${formatToman(gross)}</td></tr>
    <tr><td style="text-align: left;">جمع کسورات</td><td>-${formatToman(totalDeductions)}</td></tr>
    <tr class="final"><td style="text-align: left;">خالص پرداختی</td><td>${formatToman(net)}</td></tr>
  </table>

  <div class="footer">این سند به‌صورت خودکار توسط ${escapeHtml(employer.orgName)} صادر شده است.</div>
</body>
</html>`;
}
