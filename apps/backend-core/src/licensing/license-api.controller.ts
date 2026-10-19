import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clientIp } from '../security/client-ip.js';
import { LicensePublicService, type PublicAction, type PublicBody } from './license-public.service.js';
import { LicenseThrottle, equalizeTiming } from './license-throttle.js';
import { normalizeIdentifier } from './license-key.js';
import { LicenseSigningService } from './license-signing.service.js';

const THROTTLE = new LicenseThrottle();
const FAIL_CODES = new Set<PublicBody['code']>(['license_not_found', 'missing_license_key']);

/**
 * API عمومی لایسنس (بدون ورود؛ احراز هویت فقط با license_key). فقط POST (کلید لایسنس در URL/لاگ دسترسی نمی‌افتد).
 * مسیرهای صریح: verify / activate / deactivate / checkin + crl و public-key (عمومی، بدون راز).
 * ضد حدس‌زدن: سقف نرخ + قفل نمایی به ازای IP + یکسان‌سازی زمان پاسخ برای حالت‌های ناموفق.
 */
@Controller('license-api')
export class LicenseApiController {
  constructor(
    private readonly svc: LicensePublicService,
    private readonly signer: LicenseSigningService,
  ) {}

  private async run(action: PublicAction, body: Record<string, unknown> | undefined, req: Request, res: Response): Promise<PublicBody> {
    const started = Date.now();
    const ip = clientIp(req);
    const b = body && typeof body === 'object' ? body : {};
    const input = {
      action,
      licenseKey: b.license_key,
      identifier: b.identifier,
      fingerprint: b.fingerprint,
      nonce: b.nonce,
      telemetry: b.telemetry,
      ip,
    };
    const trustedId = normalizeIdentifier(b.identifier) || undefined;
    const verdict = THROTTLE.check(ip, Date.now(), trustedId);
    if (!verdict.allowed) {
      const r = await this.svc.reject(input, 'rate_limited');
      res.setHeader('Retry-After', String(verdict.retryAfterSec));
      res.status(r.http);
      await equalizeTiming(started);
      return r.body;
    }
    const r = await this.svc.handle(input);
    if (FAIL_CODES.has(r.body.code)) THROTTLE.recordFailure(ip);
    else if (r.body.success) THROTTLE.recordSuccess(ip, r.body.code === 'deactivated' ? undefined : trustedId);
    if (!r.body.success) await equalizeTiming(started);
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.http);
    return r.body;
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run('verify', body, req, res);
  }

  @Post('activate')
  @HttpCode(200)
  activate(@Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run('activate', body, req, res);
  }

  @Post('deactivate')
  @HttpCode(200)
  deactivate(@Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run('deactivate', body, req, res);
  }

  @Post('checkin')
  @HttpCode(200)
  checkin(@Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run('checkin', body, req, res);
  }

  /** CRL امضاشده — فقط هش‌های کوتاه‌شده‌ی کلیدهای لغوشده؛ برای نصب‌هایی که می‌خواهند بدون فعال‌سازی دوباره بررسی کنند. */
  @Get('crl')
  async crl(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const v = THROTTLE.check(clientIp(req));
    if (!v.allowed) {
      res.status(429).setHeader('Retry-After', String(v.retryAfterSec));
      return { success: false, code: 'rate_limited' };
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    return { success: true, crl: await this.svc.currentCrl() };
  }

  /** کلید عمومی فعلی (برای راه‌اندازی/تأیید دستی). محصول باید کلید را از بسته‌ی نصب بگیرد، نه از همین endpoint (TOFU). */
  @Get('public-key')
  publicKey() {
    return { kid: this.signer.kid, publicKeyPem: this.signer.publicKeyPem() };
  }
}
