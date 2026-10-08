import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { formatJalaliDate, formatToman } from '../common/persian.js';
import { VAZIRMATN_FONT_BASE64 as FONT_BASE64, escapeHtml } from '../common/pdf-font.js';
import { hardenPage, safeImgSrc } from '../security/puppeteer-hardening.js';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  ACTIVE: 'فعال',
  EXPIRED: 'منقضی‌شده',
  TERMINATED: 'فسخ‌شده',
};

type ContractForPdf = {
  contractNo: number;
  title: string;
  status: string;
  value: number;
  startDate: Date;
  endDate: Date;
  terms: string | null;
  guaranteeTerms: string | null;
  isLocked: boolean;
  contentHash: string | null;
  partyASignerName: string | null;
  partyASignatureDataUrl: string | null;
  partyASignedAt: Date | null;
  partyBSignerName: string | null;
  partyBSignatureDataUrl: string | null;
  partyBSignedAt: Date | null;
  partyBSignedAsDelegate: boolean;
  firstPartyName: string;
  secondPartyName: string;
  witnesses: Array<{ name: string; signatureDataUrl: string | null; signedAt: Date | null }>;
};

type CompanyStamp = { signatureImage?: string; stampImage?: string };

/** Renders a tenant's contract to a print-ready PDF — same rendering approach as SalesInvoicePdfService. */
@Injectable()
export class ContractPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('ContractPdfService');
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

  async render(contract: ContractForPdf, orgName: string, stamp?: CompanyStamp): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await hardenPage(page);
    try {
      await page.setContent(buildHtml(contract, orgName, stamp), { waitUntil: 'load' });
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

  async renderHtml(contract: ContractForPdf, orgName: string, stamp?: CompanyStamp): Promise<string> {
    return buildHtml(contract, orgName, stamp);
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

function signatureBox(
  title: string,
  signerName: string | null,
  signatureDataUrl: string | null,
  signedAt: Date | null,
  stampImageUrl?: string | null,
  delegateLabel?: string | null,
): string {
  return `
  <div class="sig-box">
    <div class="sig-title">${escapeHtml(title)}</div>
    <div class="sig-images">
      ${signatureDataUrl ? `<img class="sig-img" src="${safeImgSrc(signatureDataUrl)}" />` : ''}
      ${stampImageUrl ? `<img class="stamp-img" src="${safeImgSrc(stampImageUrl)}" />` : ''}
      ${!signatureDataUrl && !stampImageUrl ? '<div class="sig-empty">امضا نشده</div>' : ''}
    </div>
    ${signerName ? `<div class="sig-name">${escapeHtml(signerName)}</div>` : ''}
    ${delegateLabel ? `<div class="sig-delegate">از طرف ${escapeHtml(delegateLabel)}</div>` : ''}
    ${signedAt ? `<div class="sig-date">${formatJalaliDate(signedAt)}</div>` : ''}
  </div>`;
}

function buildHtml(contract: ContractForPdf, orgName: string, stamp?: CompanyStamp): string {
  const companySignatureBox = signatureBox(
    'طرف دوم / شرکت',
    contract.partyBSignerName,
    contract.partyBSignatureDataUrl,
    contract.partyBSignedAt,
    contract.partyBSignedAt ? stamp?.stampImage : null,
    contract.partyBSignedAsDelegate ? contract.partyBSignerName : null,
  );
  return buildContractHtml(contract, orgName, companySignatureBox);
}

function buildContractHtml(contract: ContractForPdf, orgName: string, companySignatureBox: string): string {
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
  body { font-family: 'Vazirmatn', Tahoma, sans-serif; margin: 0; color: #1c2333; font-size: 13px; line-height: 1.9; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 18px; font-weight: 800; color: #4f46e5; }
  .meta { text-align: left; font-size: 12px; color: #475569; }
  .meta b { color: #1c2333; }
  .status { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 8px; margin-top: 6px; }
  .status.ACTIVE { background: #dcfce7; color: #16a34a; }
  .status.DRAFT { background: #f1f5f9; color: #64748b; }
  .status.TERMINATED, .status.EXPIRED { background: #fee2e2; color: #dc2626; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .parties { display: flex; gap: 16px; margin: 20px 0; }
  .party-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .party-box .label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
  .party-box .name { font-size: 13.5px; font-weight: 700; }
  .section-title { font-size: 12px; font-weight: 700; color: #64748b; margin: 20px 0 8px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; white-space: pre-wrap; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
  .info-grid .item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; }
  .info-grid .item .label { font-size: 10.5px; color: #64748b; }
  .info-grid .item .value { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .signatures { display: flex; gap: 16px; margin-top: 28px; flex-wrap: wrap; }
  .sig-box { flex: 1; min-width: 160px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .sig-box .sig-title { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
  .sig-images { display: flex; align-items: center; gap: 8px; }
  .sig-images img { max-height: 60px; max-width: 100%; }
  .sig-images .stamp-img { max-height: 68px; opacity: 0.92; }
  .sig-box .sig-name { font-size: 12.5px; font-weight: 700; margin-top: 6px; }
  .sig-box .sig-delegate { font-size: 11px; color: #64748b; margin-top: 2px; }
  .sig-box .sig-date { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
  .sig-empty { font-size: 11.5px; color: #94a3b8; }
  .footer { margin-top: 32px; text-align: center; font-size: 10.5px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(orgName)}</div>
    </div>
    <div class="meta">
      <div>شماره قرارداد: <b>${contract.contractNo.toLocaleString('fa-IR')}</b></div>
      <div>تاریخ شروع: <b>${formatJalaliDate(contract.startDate)}</b></div>
      <div>تاریخ پایان: <b>${formatJalaliDate(contract.endDate)}</b></div>
      <div class="status ${contract.status}">${STATUS_LABELS[contract.status] ?? contract.status}</div>
    </div>
  </div>

  <h1>${escapeHtml(contract.title)}</h1>

  <div class="parties">
    <div class="party-box">
      <div class="label">طرف اول</div>
      <div class="name">${escapeHtml(contract.firstPartyName)}</div>
    </div>
    <div class="party-box">
      <div class="label">طرف دوم</div>
      <div class="name">${escapeHtml(contract.secondPartyName)}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="item"><div class="label">ارزش قرارداد</div><div class="value">${formatToman(contract.value)}</div></div>
    <div class="item"><div class="label">وضعیت امضا</div><div class="value">${contract.isLocked ? 'امضا و قفل‌شده' : 'در انتظار امضا'}</div></div>
  </div>

  ${contract.terms ? `<div class="section-title">شرح بندها و شرایط</div><div class="box">${escapeHtml(contract.terms)}</div>` : ''}
  ${contract.guaranteeTerms ? `<div class="section-title">ضمانت اجرا</div><div class="box">${escapeHtml(contract.guaranteeTerms)}</div>` : ''}

  <div class="section-title">امضاها</div>
  <div class="signatures">
    ${signatureBox('طرف اول', contract.partyASignerName, contract.partyASignatureDataUrl, contract.partyASignedAt)}
    ${companySignatureBox}
    ${contract.witnesses.map((w) => signatureBox(`شاهد — ${w.name}`, w.name, w.signatureDataUrl, w.signedAt)).join('')}
  </div>

  ${contract.contentHash ? `<div class="footer">کد اصالت سند: ${contract.contentHash}</div>` : ''}
</body>
</html>`;
}
