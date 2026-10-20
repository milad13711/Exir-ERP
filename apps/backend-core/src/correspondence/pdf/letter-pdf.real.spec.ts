import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer';
import { defaultLayout } from '../letterhead-layout.js';
import type { LetterRenderInput } from '../render-input.js';
import { countPdfPages, LetterPdfService } from './letter-pdf.service.js';

/** رندر واقعی با Chromium (اگر نصب باشد). بدون Chromium: با پیام روشن رد می‌شود (skip). */
function chromiumAvailable(): boolean {
  try {
    const p = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    return !!p && existsSync(p);
  } catch {
    return false;
  }
}
const has = chromiumAvailable();
if (!has) console.warn('[letter-pdf.real.spec] Chromium یافت نشد — تست‌های رندر واقعی skip شدند');

const para = '<p>این یک پاراگراف آزمایشی برای متن نامه است که باید در چند خط شکسته شود و تراز دوطرفه شود. متن ادامه دارد تا به خطوط بعدی برسد.</p>';
const input = (n: number): LetterRenderInput => ({
  letterhead: { imageDataUri: null, layout: { ...defaultLayout(), letterheadOnAllPages: true } },
  number: '1405/1', dateText: '۱۴۰۵/۰۷/۲۹', subject: 'موضوع', bodyHtml: para.repeat(n), attachmentsText: null,
  recipients: [{ name: 'گیرنده', title: 'سمت' }], ccNames: [], sender: { name: 'فرستنده', title: 'سمت' },
  paraphs: [{ authorName: 'الف', text: 'متن', dateText: 'د' }], signature: null, qr: { verifyUrl: 'https://x.test/v/1' },
  watermark: 'پیش‌نویس', confidentialityLabel: null, priorityLabel: null,
});

describe.skipIf(!has)('LetterPdfService (Chromium واقعی)', () => {
  const svc = new LetterPdfService();
  afterAll(() => svc.onModuleDestroy());

  it('۱ صفحه', async () => {
    const pdf = await svc.render(input(3));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(countPdfPages(pdf)).toBe(1);
  }, 60_000);
  it('چندصفحه‌ای (متن طولانی) و ۵ صفحه', async () => {
    const two = await svc.render(input(26));
    expect(countPdfPages(two)).toBeGreaterThanOrEqual(2);
    expect(countPdfPages(two)).toBeLessThanOrEqual(3);
    const five = await svc.render(input(130));
    expect(countPdfPages(five)).toBeGreaterThanOrEqual(5);
  }, 120_000);
  it('برگ ثبت و برچسب: یک صفحه', async () => {
    const slip = { orgName: 'شرکت', secretariatNumber: '1405/7', registeredAtText: '۱۴۰۵/۰۷/۲۹', externalNumber: '9', externalDateText: null, senderName: 'ف', subject: 'م', pageCount: 2, attachmentsText: null, registrarName: 'ث', qr: { verifyUrl: 'https://x.test/1' } };
    expect(countPdfPages(await svc.renderIncomingSlip(slip))).toBe(1);
    expect(countPdfPages(await svc.renderIncomingSlip(slip, { variant: 'label' }))).toBe(1);
  }, 60_000);
  it('SSRF: درخواست http/file از صفحه‌ی سخت‌شده هرگز به سرور نمی‌رسد', async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'image/png' }).end('x');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const page = await svc.openHardenedPage();
    try {
      await page.setContent(`<img src="http://127.0.0.1:${port}/a.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/s.css"><iframe src="file:///etc/hosts"></iframe><style>body{background:url(http://127.0.0.1:${port}/b.png)}</style><script>fetch("http://127.0.0.1:${port}/js")</script>`, { waitUntil: 'load' });
      await page.pdf();
    } finally {
      await page.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect(hits).toBe(0);
  }, 60_000);
});
