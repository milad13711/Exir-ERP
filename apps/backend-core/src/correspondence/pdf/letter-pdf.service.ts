import { BadRequestException, HttpException, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import QRCode from 'qrcode';
import { chromiumLaunchOptions } from '../../common/chromium-launch.js';
import { TokenBuckets } from './token-bucket.js';
import { validateLayout } from '../letterhead-layout.js';
import type { IncomingSlipRenderInput, LetterRenderInput } from '../render-input.js';
import { buildLetterHtml } from './letter-html.js';
import { buildSlipHtml, type SlipVariant } from './slip-html.js';
import { htmlSizeWithoutImages, MAX_LETTER_IMAGE_BYTES, MAX_LETTERHEAD_IMAGE_BYTES, safeLetterImage, sanitizeLetterHtml } from './sanitize-letter-html.js';

export const LETTER_LIMITS = {
  bodyBytes: 500 * 1024,
  imageBytes: MAX_LETTER_IMAGE_BYTES,
  paraphs: 20,
  recipients: 60,
  shortText: 2000,
  paraphText: 4000,
} as const;

export type LetterRenderOptions = {
  persianDigits?: boolean;
  /** سهم عادلانه: تننت/کاربر درخواست‌دهنده */
  tenantId?: string;
  userId?: string;
  /** مسیر امضا: slot رزرو و معاف از سطل توکن */
  priority?: boolean;
};

/** فقط data: و about:blank؛ هر چیز دیگر (http/https/file/ftp/ws/blob/…) قطع می‌شود. */
export function isAllowedLetterRequestUrl(url: string): boolean {
  return url.startsWith('data:') || url === 'about:blank';
}

/** تعداد صفحات PDF تولیدشده‌ی Chromium (ریشه‌ی /Type /Pages /Count n؛ بزرگ‌ترین مقدار). */
export function countPdfPages(pdf: Buffer): number {
  const s = pdf.toString('latin1');
  let max = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)) max = Math.max(max, Number(m[1]));
  if (max === 0) for (const m of s.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) max = Math.max(max, Number(m[1]));
  if (max === 0) max = (s.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  return Math.max(max, 1);
}

const clip = (s: unknown, n: number): string => (typeof s === 'string' ? s.slice(0, n) : '');
const clipOrNull = (s: unknown, n: number): string | null => (typeof s === 'string' && s ? s.slice(0, n) : null);

function checkImage(uri: string | null | undefined, what: string, maxBytes: number = LETTER_LIMITS.imageBytes): string | null {
  if (!uri) return null;
  const ok = safeLetterImage(uri, maxBytes);
  if (!ok) throw new BadRequestException(`${what}: فقط تصویر PNG/JPEG/WebP تا ${Math.round(maxBytes / 1048576)} مگابایت و حداکثر ۲۵ مگاپیکسل پذیرفته می‌شود`);
  return ok;
}

/**
 * ورودی را «مرزبانی» می‌کند: بدنه دوباره پاک‌سازی (حتی اگر فراخواننده پیش‌تر کرده)، چیدمان دوباره اعتبارسنجی،
 * تصاویر بررسی و سقف‌ها اعمال می‌شود. خروجی همان شکل ورودی است اما قابل‌اعتماد. تابع خالص (بدون Chromium).
 */
export function normalizeLetterInput(input: LetterRenderInput): LetterRenderInput {
  const lay = validateLayout(input.letterhead.layout, input.letterhead.layout?.pageSize, input.letterhead.layout?.orientation);
  const bodyHtml = sanitizeLetterHtml(input.bodyHtml ?? '');
  if (htmlSizeWithoutImages(bodyHtml) > LETTER_LIMITS.bodyBytes) throw new BadRequestException('متن نامه بیش از حد بزرگ است (حداکثر ۵۰۰ کیلوبایت)');
  if (input.paraphs.length > LETTER_LIMITS.paraphs) throw new BadRequestException(`حداکثر ${LETTER_LIMITS.paraphs} پاراف در PDF قابل چاپ است`);
  if (input.recipients.length > LETTER_LIMITS.recipients) throw new BadRequestException('تعداد گیرندگان بیش از حد است');
  return {
    letterhead: { imageDataUri: checkImage(input.letterhead.imageDataUri, 'تصویر سربرگ', MAX_LETTERHEAD_IMAGE_BYTES), layout: lay },
    number: clipOrNull(input.number, 100),
    dateText: clip(input.dateText, 100),
    subject: clip(input.subject, LETTER_LIMITS.shortText),
    bodyHtml,
    attachmentsText: clipOrNull(input.attachmentsText, LETTER_LIMITS.shortText),
    recipients: input.recipients.map((r) => ({ name: clip(r.name, 300), title: clipOrNull(r.title, 300) })),
    ccNames: input.ccNames.slice(0, LETTER_LIMITS.recipients).map((n) => clip(n, 300)),
    sender: { name: clip(input.sender?.name, 300), title: clipOrNull(input.sender?.title, 300) },
    paraphs: input.paraphs.map((p) => ({
      authorName: clip(p.authorName, 300),
      authorTitle: clipOrNull(p.authorTitle, 300),
      text: clip(p.text, LETTER_LIMITS.paraphText),
      dateText: clip(p.dateText, 100),
    })),
    signature: input.signature
      ? {
          imageDataUri: checkImage(input.signature.imageDataUri, 'تصویر امضا'),
          stampDataUri: checkImage(input.signature.stampDataUri, 'تصویر مهر'),
          signerName: clip(input.signature.signerName, 300),
          signerTitle: clipOrNull(input.signature.signerTitle, 300),
          signedAtText: clip(input.signature.signedAtText, 100),
          // خطوط نهایی بلوک امضا (سمت + شرکت / پیشوند + نام) — بدون این‌ها رندر فقط signerTitle (سمت بدون نام شرکت) را چاپ می‌کرد
          ...(typeof input.signature.titleLine === 'string' ? { titleLine: input.signature.titleLine.slice(0, 300) } : {}),
          ...(typeof input.signature.nameLine === 'string' ? { nameLine: input.signature.nameLine.slice(0, 300) } : {}),
          // undefined = «تاریخ امضا را بزن»، null = «تاریخ نزن»
          ...(input.signature.dateLabel === null ? { dateLabel: null } : typeof input.signature.dateLabel === 'string' ? { dateLabel: input.signature.dateLabel.slice(0, 100) } : {}),
        }
      : null,
    qr: input.qr && /^https?:\/\/[^\s"'<>]{1,1900}$/i.test(input.qr.verifyUrl) ? { verifyUrl: input.qr.verifyUrl } : null,
    watermark: input.watermark === 'پیش‌نویس' || input.watermark === 'باطل‌شده' ? input.watermark : null,
    confidentialityLabel: clipOrNull(input.confidentialityLabel, 100),
    priorityLabel: clipOrNull(input.priorityLabel, 100),
  };
}

async function qrDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  return QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
}

/**
 * HTML→PDF با Chromium سیستمی. امنیت: جاوااسکریپت خاموش، intercept و قطع هر درخواست غیر data:، CSP در خود سند،
 * زمان‌بند سخت، صف هم‌زمانی (LETTER_PDF_CONCURRENCY، پیش‌فرض ۲؛ حداکثر ۲۰ منتظر)، سقف حجم ورودی.
 */
type BrowserHandle = { browser: Browser; inflight: number; renders: number; retired: boolean };
type Job = { pages: Set<Page> };

@Injectable()
export class LetterPdfService implements OnModuleDestroy {
  private readonly logger = new Logger('LetterPdfService');
  private handlePromise: Promise<BrowserHandle> | null = null;
  private active = 0;
  private priorityActive = 0;
  private readonly waiters: Array<() => void> = [];
  readonly maxConcurrency = Math.max(1, Number(process.env.LETTER_PDF_CONCURRENCY ?? 2) || 2);
  readonly maxQueue = 20;
  /** یک slot رزرو فقط برای مسیر امضا (فاز ۲) تا امضا با شلوغی ۵۰۳ نخورد */
  readonly reservedSlots = 1;
  readonly timeoutMs = Math.max(5000, Number(process.env.LETTER_PDF_TIMEOUT_MS ?? 30000) || 30000);
  /** بازیافت مرورگر پس از این تعداد رندر (نشت حافظه/وضعیت) */
  readonly recycleAfter = Math.max(5, Number(process.env.LETTER_PDF_RECYCLE_AFTER ?? 100) || 100);
  private readonly tenantBuckets = new TokenBuckets(Number(process.env.LETTER_PDF_TENANT_BURST ?? 20), Number(process.env.LETTER_PDF_TENANT_PER_MIN ?? 40));
  private readonly userBuckets = new TokenBuckets(Number(process.env.LETTER_PDF_USER_BURST ?? 8), Number(process.env.LETTER_PDF_USER_PER_MIN ?? 15));

  private async getHandle(): Promise<BrowserHandle> {
    if (this.handlePromise) {
      const h = await this.handlePromise.catch(() => null);
      if (h && h.browser.connected && !h.retired) return h;
      this.handlePromise = null;
    }
    this.handlePromise = puppeteer.launch(chromiumLaunchOptions()).then((browser) => ({ browser, inflight: 0, renders: 0, retired: false }));
    return this.handlePromise;
  }

  private async closeHandle(h: BrowserHandle): Promise<void> {
    await h.browser.close().catch((err) => this.logger.warn(`Failed closing Chromium: ${err instanceof Error ? err.message : err}`));
  }

  /** مرورگر پس از N رندر بازنشانی می‌شود؛ مرورگر قدیمی پس از اتمام کارهای در جریانش بسته می‌شود. */
  private async afterRender(h: BrowserHandle): Promise<void> {
    h.inflight--;
    h.renders++;
    if (h.renders >= this.recycleAfter && !h.retired) {
      h.retired = true;
      this.handlePromise = null;
    }
    if (h.retired && h.inflight === 0) await this.closeHandle(h);
  }

  private async acquire(priority: boolean): Promise<void> {
    if (priority) {
      if (this.active < this.maxConcurrency + this.reservedSlots) {
        this.active++;
        this.priorityActive++;
        return;
      }
      // رزرو هم پر است: منتظر می‌ماند (صف اولویت‌دار)
      await new Promise<void>((resolve) => this.waiters.unshift(resolve));
      this.priorityActive++;
      return;
    }
    // کارهای عادی از slot رزرو استفاده نمی‌کنند
    if (this.active - this.priorityActive < this.maxConcurrency && this.active < this.maxConcurrency + this.reservedSlots) {
      this.active++;
      return;
    }
    if (this.waiters.length >= this.maxQueue) throw new ServiceUnavailableException('سرویس تولید PDF شلوغ است؛ چند لحظه‌ی دیگر دوباره تلاش کنید');
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(priority: boolean): void {
    if (priority) this.priorityActive--;
    const next = this.waiters.shift();
    if (next) next(); // slot منتقل می‌شود
    else this.active--;
  }

  /** سهم عادلانه: هر تننت و هر کاربر سطل توکن جدا دارد (مسیر امضا معاف است). */
  private assertQuota(opts: { tenantId?: string; userId?: string; priority?: boolean }): void {
    if (opts.priority) return;
    if (!this.tenantBuckets.take(`t:${opts.tenantId ?? 'anon'}`) || !this.userBuckets.take(`u:${opts.tenantId ?? 'anon'}:${opts.userId ?? 'anon'}`)) {
      throw new HttpException('تعداد درخواست‌های ساخت PDF بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید', 429);
    }
  }

  /** یک صفحه‌ی سخت‌شده در context تازه می‌سازد: JS خاموش + قطع هر درخواست غیر data:. بستن صفحه، context را هم می‌بندد. */
  async openHardenedPage(job?: Job): Promise<Page> {
    const h = await this.getHandle();
    h.inflight++;
    const ctx = await h.browser.createBrowserContext().catch(async (e) => {
      await this.afterRender(h);
      throw e;
    });
    let page: Page;
    try {
      page = await ctx.newPage();
    } catch (e) {
      await ctx.close().catch(() => undefined);
      await this.afterRender(h);
      throw e;
    }
    const origClose = page.close.bind(page);
    let closed = false;
    page.close = (async (o?: { runBeforeUnload?: boolean }) => {
      if (closed) return;
      closed = true;
      job?.pages.delete(page);
      await origClose(o).catch(() => undefined);
      await ctx.close().catch(() => undefined);
      await this.afterRender(h);
    }) as Page['close'];
    job?.pages.add(page);
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (isAllowedLetterRequestUrl(req.url())) void req.continue();
        else void req.abort('blockedbyclient');
      });
    } catch (e) {
      await page.close().catch(() => undefined);
      throw e;
    }
    return page;
  }

  private async htmlToPdf(html: string, deadline: number, job: Job): Promise<Buffer> {
    const left = Math.max(1000, deadline - Date.now());
    const page = await this.openHardenedPage(job);
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: left });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: Math.max(1000, deadline - Date.now()) });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async run<T>(opts: { tenantId?: string; userId?: string; priority?: boolean }, fn: (deadline: number, job: Job) => Promise<T>): Promise<T> {
    this.assertQuota(opts);
    const priority = !!opts.priority;
    await this.acquire(priority);
    const deadline = Date.now() + this.timeoutMs;
    const job: Job = { pages: new Set() };
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(deadline, job),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => {
            // slot فقط وقتی واقعاً آزاد شود که صفحه‌های این کار بسته شده باشند
            void Promise.allSettled([...job.pages].map((p) => p.close()));
            rej(new ServiceUnavailableException('تولید PDF بیش از حد طول کشید'));
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      await Promise.allSettled([...job.pages].map((p) => p.close()));
      this.release(priority);
    }
  }

  async render(input: LetterRenderInput, options: LetterRenderOptions = {}): Promise<Buffer> {
    const safe = normalizeLetterInput(input);
    const qr = await qrDataUri(safe.qr?.verifyUrl);
    const persianDigits = options.persianDigits ?? false;
    return this.run(options, async (deadline, job) => {
      const first = await this.htmlToPdf(buildLetterHtml(safe, { qrDataUri: qr, flow: false, pageTotal: null, persianDigits }), deadline, job);
      if (countPdfPages(first) <= 1) return first;
      // نامه‌ی چندصفحه‌ای: امضا/پاراف/QR به انتهای متن می‌روند؛ سپس شماره‌ی صفحه با شمار واقعی
      const flowOpts = { qrDataUri: qr, flow: true, persianDigits };
      const flowPdf = await this.htmlToPdf(buildLetterHtml(safe, { ...flowOpts, pageTotal: null }), deadline, job);
      const total = countPdfPages(flowPdf);
      if (total <= 1) return flowPdf;
      return this.htmlToPdf(buildLetterHtml(safe, { ...flowOpts, pageTotal: total }), deadline, job);
    });
  }

  /** برگ ثبت وارده (A6 افقی) یا برچسب ۶۰×۴۰. headerImageDataUri = تصویر سربرگ پیش‌فرض (اختیاری، نوار بالای برگ). */
  async renderIncomingSlip(
    input: IncomingSlipRenderInput,
    options: { variant?: SlipVariant; headerImageDataUri?: string | null; persianDigits?: boolean; tenantId?: string; userId?: string } = {},
  ): Promise<Buffer> {
    const variant: SlipVariant = options.variant === 'label' ? 'label' : 'slip';
    const safe: IncomingSlipRenderInput = {
      orgName: clip(input.orgName, 200),
      secretariatNumber: clip(input.secretariatNumber, 60),
      registeredAtText: clip(input.registeredAtText, 100),
      externalNumber: clipOrNull(input.externalNumber, 100),
      externalDateText: clipOrNull(input.externalDateText, 100),
      senderName: clip(input.senderName, 300),
      subject: clip(input.subject, 400),
      pageCount: typeof input.pageCount === 'number' && Number.isFinite(input.pageCount) ? Math.max(0, Math.min(100000, Math.floor(input.pageCount))) : null,
      attachmentsText: clipOrNull(input.attachmentsText, 300),
      registrarName: clip(input.registrarName, 200),
      qr: input.qr && /^https?:\/\/[^\s"'<>]{1,1900}$/i.test(input.qr.verifyUrl) ? { verifyUrl: input.qr.verifyUrl } : null,
    };
    const header = checkImage(options.headerImageDataUri, 'تصویر سربرگ');
    const qr = await qrDataUri(safe.qr?.verifyUrl);
    const html = buildSlipHtml(safe, { variant, qrDataUri: qr, headerImageDataUri: header, persianDigits: options.persianDigits ?? true });
    return this.run(options, (deadline, job) => this.htmlToPdf(html, deadline, job));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.handlePromise) {
      const h = await this.handlePromise.catch(() => null);
      if (h) await this.closeHandle(h);
    }
  }
}
