import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EbookDeliveryService, type EbookFileKind } from '../book-store/ebook-delivery.service.js';
import { verifyDownload } from '../book-store/ebook-license.js';
import { PublicBookStoreService } from './public-book-store.service.js';
import { BookLibraryDto } from './dto/book-library.dto.js';
import { VerifyBookLicenseDto } from './dto/verify-book-license.dto.js';
import { brandPage, ebookDeliveryBlock, esc, siteUrl } from './book-store-pages.js';

/** دانلود حداکثر این‌قدر منتظر ساخت نسخه می‌ماند (زیر proxy_read_timeout پیش‌فرض ۶۰ ثانیه‌ی nginx)؛ بعد به صفحه‌ی دریافت برمی‌گردد. */
const DOWNLOAD_WAIT_MS = 45_000;

const CONTENT_TYPE: Record<EbookFileKind, string> = { pdf: 'application/pdf', epub: 'application/epub+zip' };

/**
 * دریافت نسخه‌ی الکترونیک — صفحه‌ی دریافت و دو فایل پشت یک لینک امضاشده‌ی منقضی‌شونده،
 * «کتابخانه‌ی من» با OTP، و استعلام اصالت مجوز. فایل‌ها هرگز مستقیم سرو استاتیک نمی‌شوند.
 */
@Controller('public/book/:slug')
export class PublicBookEbookController {
  constructor(
    private readonly bookStore: PublicBookStoreService,
    private readonly ebook: EbookDeliveryService,
  ) {}

  @Post('library')
  library(@Param('slug') slug: string, @Body() dto: BookLibraryDto) {
    return this.bookStore.library(slug, dto.bookingToken);
  }

  @Post('license/verify')
  verifyLicense(@Param('slug') slug: string, @Body() dto: VerifyBookLicenseDto) {
    return this.bookStore.verifyLicense(slug, dto);
  }

  /** null = لینک نامعتبر/منقضی (صفحه‌ی خطا همین‌جا فرستاده شده). */
  private async authorize(slug: string, orderId: string, e: unknown, s: unknown, res: Response) {
    const ctx = await this.bookStore.resolveTenantCtx(slug);
    const secret = this.ebook.secretFor(ctx);
    if (!secret) throw new NotFoundException('این لینک دیگر معتبر نیست');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const check = verifyDownload(secret, orderId, e, s);
    if (check !== 'ok') {
      const site = siteUrl();
      const title = check === 'expired' ? 'مهلت این لینک تمام شده است' : 'این لینک معتبر نیست';
      res.status(check === 'expired' ? 410 : 403).send(
        brandPage(
          `<div class="icon">⏳</div><h1>${title}</h1><p>لینک‌های دانلود موقت‌اند. با شماره‌ای که با آن خرید کرده‌اید وارد «کتابخانه‌ی من» شوید تا لینک تازه بگیرید.</p>${
            site ? `<a class="btn" href="${esc(site)}/library">کتابخانه‌ی من</a>` : ''
          }`,
        ),
      );
      return null;
    }
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order || order.format !== 'EBOOK' || !order.paidAt) throw new NotFoundException('این سفارش یافت نشد');
    return { ctx, order };
  }

  @Get('ebook/:orderId')
  async page(
    @Param('slug') slug: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('e') e: unknown,
    @Query('s') s: unknown,
    @Res() res: Response,
  ) {
    const auth = await this.authorize(slug, orderId, e, s, res);
    if (!auth) return;
    const { ctx, order } = auth;
    const ready = await this.ebook.isIssued(ctx, order);
    const inflight = this.ebook.isIssuing(ctx, order.id);
    // بعد از خطا، تلاش دوباره فقط با کلیک روی دکمه‌ی دانلود — نه با هر بار باز شدن/رفرش صفحه
    if (!ready && !inflight && !order.ebookError) void this.ebook.ensureIssued(ctx, order);
    const failed = !ready && !inflight && !!order.ebookError;
    const links = this.ebook.links(ctx, order.id)!;
    res.send(
      brandPage(
        `<div class="icon">📘</div><h1>نسخه‌ی الکترونیک «سلطان قیف»</h1><p>سفارش شماره‌ی ${order.orderNo}</p>${ebookDeliveryBlock({
          licenseCode: order.licenseCode,
          pdfUrl: links.pdfUrl,
          epubUrl: links.epubUrl,
          ready,
          failed,
        })}`,
        { refreshSeconds: ready || failed ? undefined : 10 },
      ),
    );
  }

  @Get('ebook/:orderId/:kind')
  async download(
    @Param('slug') slug: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('kind') kind: string,
    @Query('e') e: unknown,
    @Query('s') s: unknown,
    @Res() res: Response,
  ) {
    if (kind !== 'pdf' && kind !== 'epub') throw new NotFoundException();
    const auth = await this.authorize(slug, orderId, e, s, res);
    if (!auth) return;
    const { ctx, order } = auth;

    if (!(await this.ebook.isIssued(ctx, order))) {
      const ready = await Promise.race([
        this.ebook.ensureIssued(ctx, order),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), DOWNLOAD_WAIT_MS).unref()),
      ]);
      if (!ready) return res.redirect(303, `../${orderId}?e=${encodeURIComponent(String(e))}&s=${encodeURIComponent(String(s))}`);
    }
    const path = this.ebook.filePath(ctx, order, kind)!;
    res.type(CONTENT_TYPE[kind]);
    res.download(path, `soltan-ghif-${order.orderNo}.${kind}`, { dotfiles: 'deny', headers: { 'Cache-Control': 'private, no-store' } }, (err) => {
      if (err && !res.headersSent) res.status(404).send(brandPage('<div class="icon">❌</div><h1>فایل پیدا نشد</h1><p>لطفاً دوباره تلاش کنید.</p>'));
    });
  }
}
