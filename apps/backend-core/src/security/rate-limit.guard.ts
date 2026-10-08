import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clientIp, isInternalCall } from './client-ip.js';
import { buildRouteRules, GENERIC_IP_RULE, RateLimitStore, TOKEN_RULE, tokenFingerprint, type RateRule } from './rate-limit.js';
import { SecurityEventsService } from './security-events.service.js';

/**
 * گارد سراسری (APP_GUARD) — پیش از همه‌ی گاردهای کنترلرها اجرا می‌شود، پس هجوم احراز‌هویت‌نشده
 * هیچ‌وقت به DB نمی‌رسد. کلیدها: IP واقعی (X-Real-IP پشت پروکسی معتبر)، شماره‌ی موبایل بدنه (OTP)، اثر انگشت توکن.
 *
 * متغیرهای محیطی: RATE_LIMIT_DISABLED=true (کلید اضطراری)، RATE_LIMIT_REPORT_ONLY=true (فقط لاگ، بدون رد)،
 * RL_* برای تنظیم سقف‌ها (rate-limit.ts).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new RateLimitStore();
  private readonly routes = buildRouteRules();

  constructor(private readonly events: SecurityEventsService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const method = req.method.toUpperCase();
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const ip = clientIp(req);
    const internal = isInternalCall(req);

    const rules: RateRule[] = [];
    for (const r of this.routes) if (r.match(method, path)) { rules.push(...r.rules); break; }
    rules.push(GENERIC_IP_RULE());
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    if (bearer) rules.push(TOKEN_RULE());

    const phone = typeof (req.body as { phone?: unknown } | undefined)?.phone === 'string' ? ((req.body as { phone: string }).phone) : null;

    for (const rule of rules) {
      let subject: string | null;
      if (rule.by === 'ip') subject = internal ? null : ip;
      else if (rule.by === 'phone') subject = phone && /^\d{10,15}$/.test(phone) ? phone : null;
      else subject = bearer ? tokenFingerprint(bearer) : null;
      if (!subject) continue;
      // مسیرهای عمومی با :slug جدا شمرده نمی‌شوند؛ کلید = قانون + موضوع
      const verdict = this.store.hit(`${rule.name}:${subject}`, rule.limit, rule.windowSec);
      if (!verdict.allowed) {
        this.events.record({
          type: 'RATE_LIMITED',
          severity: 'WARNING',
          ip,
          message: `rate limit ${rule.name}`,
          context: { rule: rule.name, path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id'), method, subject: rule.by === 'ip' ? ip : rule.by === 'phone' ? maskPhone(subject) : subject },
          dedupeKey: `${rule.name}:${subject}`,
        });
        if (process.env.RATE_LIMIT_REPORT_ONLY === 'true') continue;
        res.setHeader('Retry-After', String(verdict.retryAfterSec));
        throw new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}

function maskPhone(p: string): string {
  return p.length >= 7 ? `${p.slice(0, 4)}***${p.slice(-3)}` : '***';
}
