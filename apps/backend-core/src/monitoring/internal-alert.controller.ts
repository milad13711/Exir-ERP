import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpException, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { isInternalCall } from '../security/client-ip.js';
import { RateLimitStore } from '../security/rate-limit.js';
import { safeEqual } from '../security/safe-compare.js';
import { MonitoringService } from './monitoring.service.js';
import { KIND_RE, normalizeMaintenanceInput, sanitizeAlertText } from './monitoring-logic.js';

const MIN_TOKEN_LEN = 32;

/**
 * POST /api/internal/alert — دریافت هشدار از اسکریپت میزبان (host-watch.sh).
 * لایه‌ها: (۱) بدون INTERNAL_ALERT_TOKEN قوی (≥۳۲ نویسه) = غیرفعال و ۴۰۴؛ (۲) فقط همتای loopback/شبکه‌ی خصوصی docker و بدون
 * هدر X-Real-IP/X-Forwarded-For (ترافیک اینترنتی از nginx همیشه یکی را دارد)؛ (۳) سقف نرخ سراسری؛ (۴) توکن ثابت‌زمان.
 * علاوه بر این، nginx میزبان باید /api/internal/ را ببندد (infra/hardening/monitoring/nginx-block-internal.conf).
 */
@Controller('internal')
export class InternalAlertController {
  private readonly limiter = new RateLimitStore(1000);

  constructor(private readonly monitoring: MonitoringService) {}

  /** احراز مشترک endpointهای داخلی: توکن قوی، همتای داخلی، سقف نرخ، توکن ثابت‌زمان. */
  private authorize(req: Request): void {
    const token = process.env.INTERNAL_ALERT_TOKEN ?? '';
    if (token.length < MIN_TOKEN_LEN) throw new NotFoundException();
    if (!isInternalCall(req)) throw new ForbiddenException();
    const max = Number(process.env.INTERNAL_ALERT_RATE_PER_10MIN) || 60;
    if (!this.limiter.hit('internal-alert', max, 600).allowed) {
      throw new HttpException('rate limited', 429);
    }
    const given = req.headers['x-internal-alert-token'];
    if (!safeEqual(typeof given === 'string' ? given : undefined, token)) throw new UnauthorizedException();
  }

  /**
   * POST /api/internal/maintenance {minutes:1..120, reason} — خاموش کردن SMS هشدارهای پایش داخلی تا minutes دقیقه (لاگ ادامه دارد، خودکار منقضی می‌شود).
   * {clear:true} پنجره را زودتر می‌بندد. هشدارهای امنیتی host-watch و پایشگر بیرونی «سرور مرده» هرگز تحت تأثیر نیستند.
   */
  @Post('maintenance')
  @HttpCode(200)
  async maintenance(@Req() req: Request, @Body() body: unknown) {
    this.authorize(req);
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (b.clear === true) {
      const r = await this.monitoring.clearMaintenance();
      return { ok: true, cleared: true, wasActive: r.wasActive };
    }
    const input = normalizeMaintenanceInput(b.minutes, b.reason);
    if (!input) throw new BadRequestException('minutes باید عدد صحیح ۱ تا ۱۲۰ باشد');
    const r = await this.monitoring.startMaintenance(input.minutes, input.reason);
    return { ok: true, until: r.until };
  }

  @Post('alert')
  @HttpCode(200)
  async alert(@Req() req: Request, @Body() body: unknown) {
    this.authorize(req);
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (b.heartbeat === true) {
      await this.monitoring.recordHostHeartbeat();
      return { ok: true, heartbeat: true };
    }
    const kind = typeof b.kind === 'string' ? b.kind : '';
    if (!KIND_RE.test(kind)) throw new BadRequestException('kind نامعتبر');
    const message = sanitizeAlertText(b.message);
    if (!message) throw new BadRequestException('message خالی است');
    const res = await this.monitoring.notify(`host:${kind}`, message, { source: 'host', resolved: b.resolved === true });
    return { ok: true, sent: res.sent, reason: res.reason ?? null };
  }
}
