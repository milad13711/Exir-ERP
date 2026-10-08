import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from './client-ip.js';
import { SecurityEventsService } from './security-events.service.js';

type Report = Record<string, unknown>;

/**
 * گیرنده‌ی گزارش تخلف CSP (حالت Report-Only وب‌پنل/ادمین/مارکتینگ). بدون احراز هویت (مرورگر کوکی/توکن نمی‌فرستد)؛
 * ورودی هرگز اعتماد نمی‌شود: فقط چند فیلد کوتاه‌شده خوانده و (با dedupe) به‌صورت INFO ثبت می‌شود. حجم بدنه ۱۶KB (main.ts).
 */
@Controller('security')
export class CspReportController {
  constructor(private readonly events: SecurityEventsService) {}

  @Post('csp-report')
  @HttpCode(204)
  report(@Body() body: unknown, @Req() req: Request): void {
    const raw = (body && typeof body === 'object' ? ((body as Report)['csp-report'] ?? (Array.isArray(body) ? (body[0] as Report)?.body : body)) : null) as Report | null;
    if (!raw || typeof raw !== 'object') return;
    const pick = (k: string, alt?: string) => String(raw[k] ?? (alt ? raw[alt] : '') ?? '').slice(0, 200);
    const directive = pick('violated-directive', 'effectiveDirective');
    const blocked = pick('blocked-uri', 'blockedURL');
    const doc = pick('document-uri', 'documentURL').split('?')[0];
    if (!directive) return;
    this.events.record({
      type: 'CONFIG_INSECURE',
      severity: 'INFO',
      ip: clientIp(req),
      message: `CSP report-only violation: ${directive} blocked=${blocked}`,
      context: { directive, blocked, document: doc },
      dedupeKey: `${directive}|${blocked}|${doc}`,
    });
  }
}
