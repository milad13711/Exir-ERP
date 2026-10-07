import { Controller, ForbiddenException, Get, Query, HttpException, HttpStatus, NotFoundException, Param, Post, Req, Res, Body, UseInterceptors } from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { PublicFormsService } from './public-forms.service.js';
import { SlidingWindowLimiter } from '../forms/rate-limiter.js';
import type { CorsDecision } from '../forms/embed-origins.js';

/** IP واقعی: پشت nginx هدر X-Real-IP (که خودِ nginx بازنویسی می‌کند) قابل‌اعتماد است؛ وگرنه IP اتصال. */
export function clientIp(req: Request): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * API عمومی فرم‌ساز (نسخه‌ی ۱) — بدون ورود. مستندات: GET …/schema و POST …/submit.
 * CORS: مبدأ `*` بدون credentials (میدلور publicFormsCorsMiddleware)؛ برای فرم‌هایی که
 * مبداهای مجاز دارند، اینجا (بر اساس خود فرم) اعمال می‌شود.
 */
@Controller('public/forms/:slug')
export class PublicFormsController {
  /** ارسال: ۱۰ بار در ۱۰ دقیقه برای هر IP و فرم، و ۴۰ بار در ۱۰ دقیقه برای هر IP در کل. */
  readonly submitLimiter = new SlidingWindowLimiter(10, 10 * 60_000);
  readonly submitIpLimiter = new SlidingWindowLimiter(40, 10 * 60_000);
  readonly readLimiter = new SlidingWindowLimiter(120, 60_000);

  constructor(private readonly forms: PublicFormsService) {}

  private tooMany(): never {
    throw new HttpException('تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
  }

  private applyCors(res: Response, decision: CorsDecision) {
    if (!decision.allowed) {
      res.removeHeader('Access-Control-Allow-Origin');
      throw new ForbiddenException('این سایت مجاز به استفاده از این فرم نیست');
    }
    if (decision.allowOrigin) res.setHeader('Access-Control-Allow-Origin', decision.allowOrigin);
    else res.removeHeader('Access-Control-Allow-Origin');
    if (decision.vary) res.vary('Origin');
  }

  @Get(':formSlug')
  async getForm(@Param('slug') slug: string, @Param('formSlug') formSlug: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.readLimiter.take(clientIp(req))) this.tooMany();
    this.applyCors(res, await this.forms.corsFor(slug, formSlug, req.headers.origin));
    return this.forms.getForm(slug, formSlug);
  }

  /** اسکیمای نسخه‌دار برای توسعه‌دهنده‌ها (وردپرس، Zapier، اپ سفارشی). */
  @Get(':formSlug/schema')
  async schema(@Param('slug') slug: string, @Param('formSlug') formSlug: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.readLimiter.take(clientIp(req))) this.tooMany();
    this.applyCors(res, await this.forms.corsFor(slug, formSlug, req.headers.origin));
    res.setHeader('X-Exir-Forms-Api', '1');
    return this.forms.getSchema(slug, formSlug);
  }

  /** QR لینک مستقیم فرم (PNG). */
  @Get(':formSlug/qr.png')
  async qr(@Param('slug') slug: string, @Param('formSlug') formSlug: string, @Query('base') base: string | undefined, @Req() req: Request, @Res() res: Response) {
    if (!this.readLimiter.take(clientIp(req))) this.tooMany();
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const png = await this.forms.getQrPng(slug, formSlug, base, `${proto}://${req.headers.host ?? 'localhost'}`);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  }

  /** تصویر کاور به‌صورت data URI ذخیره می‌شود؛ اینجا با Content-Type درست پخش می‌شود تا og:image واقعی داشته باشیم. */
  @Get(':formSlug/image')
  async coverImage(@Param('slug') slug: string, @Param('formSlug') formSlug: string, @Res() res: Response) {
    const dataUri = await this.forms.getCoverImage(slug, formSlug);
    if (!dataUri) throw new NotFoundException('تصویر یافت نشد');
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
    if (!match) throw new NotFoundException('تصویر یافت نشد');
    const [, mimeType, base64] = match;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(base64, 'base64'));
  }

  /**
   * JSON، multipart/form-data (فقط فیلد متنی — فایل رد می‌شود) یا application/x-www-form-urlencoded.
   * بدنه عمداً بدون DTO می‌آید؛ اعتبارسنجی کامل سمت سرور در validateSubmission انجام می‌شود.
   */
  @Post(':formSlug/submit')
  @UseInterceptors(NoFilesInterceptor())
  async submit(
    @Param('slug') slug: string,
    @Param('formSlug') formSlug: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = clientIp(req);
    if (!this.submitIpLimiter.take(ip) || !this.submitLimiter.take(`${ip}|${slug}|${formSlug}`)) this.tooMany();
    this.applyCors(res, await this.forms.corsFor(slug, formSlug, req.headers.origin));
    res.setHeader('X-Exir-Forms-Api', '1');
    return this.forms.submit(slug, formSlug, body, { ip, origin: req.headers.origin, referer: req.headers.referer });
  }
}
