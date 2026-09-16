import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { formatJalaliDate, formatToman } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';

type RationLineForPdf = { ingredientName: string; quantityPerAnimalKg: number | string; unitCostSnapshot: number; lineCost: number };

type RationReportForPdf = {
  sampleNo: number;
  collectedAt: Date;
  farmerName: string;
  currentLines: RationLineForPdf[];
  proposedLines: RationLineForPdf[];
  currentRationIssues: string;
  riskIfUnchanged: string;
  newRecommendations: string;
  expectedResult: string;
  urgentWarningSigns: string;
  trend: { label: string; avgMilkYieldPerAnimalLiters: number | null }[];
};

/** رندر گزارش نهایی «آزمایشگاه جیره» به PDF قابل چاپ — همان الگوی رندر ContractPdfService. */
@Injectable()
export class RationReportPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('RationReportPdfService');
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

  async render(report: RationReportForPdf, orgName: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(buildHtml(report, orgName), { waitUntil: 'load' });
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

function lineRows(lines: RationLineForPdf[]): string {
  return lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.ingredientName)}</td>
        <td dir="ltr">${l.quantityPerAnimalKg}</td>
        <td dir="ltr">${formatToman(l.unitCostSnapshot)}</td>
        <td dir="ltr">${formatToman(l.lineCost)}</td>
      </tr>`,
    )
    .join('');
}

function trendChart(trend: RationReportForPdf['trend']): string {
  const values = trend.map((t) => t.avgMilkYieldPerAnimalLiters ?? 0);
  const max = Math.max(1, ...values);
  return `<div class="chart">${trend
    .map(
      (t) => `<div class="bar-col">
        <div class="bar" style="height:${Math.round(((t.avgMilkYieldPerAnimalLiters ?? 0) / max) * 100)}px"></div>
        <div class="bar-value">${t.avgMilkYieldPerAnimalLiters ?? '—'}</div>
        <div class="bar-label">${escapeHtml(t.label)}</div>
      </div>`,
    )
    .join('')}</div>`;
}

function buildHtml(report: RationReportForPdf, orgName: string): string {
  const currentTotal = report.currentLines.reduce((s, l) => s + l.lineCost, 0);
  const proposedTotal = report.proposedLines.reduce((s, l) => s + l.lineCost, 0);
  const delta = proposedTotal - currentTotal;

  return /* html */ `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Vazirmatn'; src: url(data:font/woff2;base64,${FONT_BASE64}) format('woff2'); font-weight: 100 900; }
  * { box-sizing: border-box; }
  body { font-family: 'Vazirmatn', Tahoma, sans-serif; margin: 0; color: #1c2333; font-size: 13px; line-height: 1.9; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16a34a; padding-bottom: 16px; margin-bottom: 20px; }
  .brand { font-size: 18px; font-weight: 800; color: #16a34a; }
  .meta { text-align: left; font-size: 12px; color: #475569; }
  .meta b { color: #1c2333; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .section-title { font-size: 12px; font-weight: 700; color: #64748b; margin: 20px 0 8px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; white-space: pre-wrap; margin-bottom: 8px; }
  .box.warn { background: #fef2f2; border-color: #fecaca; color: #b91c1c; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: right; }
  th { background: #f1f5f9; font-weight: 700; }
  .compare { display: flex; gap: 16px; margin-top: 14px; }
  .compare > div { flex: 1; }
  .totals { display: flex; gap: 16px; margin-top: 12px; }
  .totals .item { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; text-align: center; }
  .totals .item .label { font-size: 10.5px; color: #64748b; }
  .totals .item .value { font-size: 14px; font-weight: 800; margin-top: 2px; }
  .chart { display: flex; align-items: flex-end; gap: 20px; height: 140px; margin-top: 10px; padding: 0 8px; }
  .bar-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; flex: 1; }
  .bar { width: 28px; background: #16a34a; border-radius: 4px 4px 0 0; }
  .bar-value { font-size: 10.5px; font-weight: 700; margin-top: 4px; }
  .bar-label { font-size: 9.5px; color: #64748b; margin-top: 2px; text-align: center; }
  .footer { margin-top: 32px; text-align: center; font-size: 10.5px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">${escapeHtml(orgName)}</div>
    <div class="meta">
      <div>شماره نمونه: <b dir="ltr">${report.sampleNo}</b></div>
      <div>تاریخ نمونه‌برداری: <b>${formatJalaliDate(report.collectedAt)}</b></div>
    </div>
  </div>

  <h1>گزارش آزمایشگاه جیره — ${escapeHtml(report.farmerName)}</h1>

  <div class="section-title">ایرادات جیره‌ی فعلی</div>
  <div class="box">${escapeHtml(report.currentRationIssues)}</div>

  <div class="section-title">ریسک عدم تغییر</div>
  <div class="box">${escapeHtml(report.riskIfUnchanged)}</div>

  <div class="section-title">توصیه‌های جدید</div>
  <div class="box">${escapeHtml(report.newRecommendations)}</div>

  <div class="section-title">نتیجه‌ی قابل انتظار</div>
  <div class="box">${escapeHtml(report.expectedResult)}</div>

  <div class="section-title">در صورت مشاهده‌ی موارد زیر فوراً به کارشناس اطلاع دهید</div>
  <div class="box warn">${escapeHtml(report.urgentWarningSigns)}</div>

  <div class="section-title">مقایسه‌ی اقتصادی جیره‌ی فعلی و پیشنهادی (به‌ازای هر دام)</div>
  <div class="compare">
    <div>
      <b>جیره‌ی فعلی</b>
      <table><thead><tr><th>ماده</th><th>مقدار (کیلو)</th><th>قیمت واحد</th><th>هزینه</th></tr></thead><tbody>${lineRows(report.currentLines)}</tbody></table>
    </div>
    <div>
      <b>جیره‌ی پیشنهادی</b>
      <table><thead><tr><th>ماده</th><th>مقدار (کیلو)</th><th>قیمت واحد</th><th>هزینه</th></tr></thead><tbody>${lineRows(report.proposedLines)}</tbody></table>
    </div>
  </div>
  <div class="totals">
    <div class="item"><div class="label">هزینه‌ی جیره‌ی فعلی</div><div class="value">${formatToman(currentTotal)}</div></div>
    <div class="item"><div class="label">هزینه‌ی جیره‌ی پیشنهادی</div><div class="value">${formatToman(proposedTotal)}</div></div>
    <div class="item"><div class="label">${delta <= 0 ? 'صرفه‌جویی' : 'افزایش هزینه'}</div><div class="value">${formatToman(Math.abs(delta))}</div></div>
  </div>

  ${report.trend.length > 0 ? `<div class="section-title">روند میانگین شیر هر دام (لیتر)</div>${trendChart(report.trend)}` : ''}

  <div class="footer">اکسیر ERP — ماژول آزمایشگاه جیره</div>
</body>
</html>`;
}
