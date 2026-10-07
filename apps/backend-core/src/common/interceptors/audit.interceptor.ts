import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator.js';
import { ActivityLogService } from '../../activity/activity-log.service.js';
import { activityActorStorage, type ActivityActor } from '../../activity/activity-context.js';
import { describeRoute, normalizeRoutePath } from '../../activity/activity-route.util.js';
import { maskIp } from '../../activity/activity-redact.util.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * ثبت خودکار همه‌ی اقدامات دستی کاربران (ایجاد/ویرایش/حذف/تأیید/ارسال/…) در لاگ فعالیت، بدون تغییر در
 * تک‌تک ماژول‌ها: بعد از موفقیت درخواست، یک ردیف در صف ActivityLogService می‌گذارد (نوشتن async و دسته‌ای —
 * هیچ کوئری‌ای روی مسیر داغ درخواست نیست). بدنه‌ی درخواست/پاسخ هرگز ثبت نمی‌شود؛ فقط شناسه‌ها و فراداده‌ی ایمن.
 * همچنین هویت درخواست‌دهنده را در AsyncLocalStorage می‌گذارد تا ارسال پیامک‌های فرعیِ همان درخواست به او نسبت داده شود.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  constructor(
    private readonly activity: ActivityLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    if (!req || !MUTATING.has(req.method)) return next.handle();

    let moduleCode: string | undefined;
    try {
      moduleCode = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_MODULE_KEY, [context.getHandler(), context.getClass()]);
    } catch {
      moduleCode = undefined;
    }

    const routePattern = (req.route?.path as string | undefined) ?? req.path ?? '';
    const actualPath = req.path ?? req.originalUrl ?? '';
    const description = safe(() => describeRoute(req.method, routePattern, actualPath, moduleCode));
    const ctx = req.ctx;

    // هویت برای نسبت‌دادن پیامک‌های فرعی: کاربر واردشده → دستی؛ درخواست عمومی → خودکار با برچسب منشأ
    const first = normalizeRoutePath(routePattern)[0];
    let actor: ActivityActor | undefined;
    if (ctx) {
      actor = { actorType: 'MANUAL', globalUserId: ctx.auth.sub, viaApiKey: ctx.auth.type === 'api_key', tenantId: ctx.tenantId, moduleCode: description?.moduleCode };
    } else if (first === 'public') {
      const sub = normalizeRoutePath(routePattern)[1];
      actor = { actorType: 'AUTOMATIC', origin: `public:${sub ?? 'form'}`, moduleCode: sub };
    }

    const run = (): Observable<unknown> =>
      next.handle().pipe(
        tap((response) => {
          if (!ctx || !description) return;
          try {
            const res = response as { id?: unknown } | null;
            const responseId = res && typeof res === 'object' && typeof res.id === 'string' && /^[0-9a-zA-Z_-]{1,64}$/.test(res.id) ? res.id : null;
            this.activity.enqueueHttp(
              ctx.tenantDb,
              { tenantId: ctx.tenantId, globalUserId: ctx.auth.sub, viaApiKey: ctx.auth.type === 'api_key' },
              {
                actorType: 'MANUAL',
                moduleCode: description.moduleCode,
                actionType: description.actionType,
                action: description.action,
                entityType: description.entityType,
                entityId: description.entityId ?? responseId,
                summary: description.summary,
                ip: maskIp(req.ip),
                metadata: { method: req.method, path: normalizedPathForLog(routePattern) },
              },
            );
          } catch (err) {
            this.logger.warn(`audit enqueue failed: ${err instanceof Error ? err.message : err}`);
          }
        }),
      );

    if (!actor) return run();
    // اجرای کل زنجیره‌ی هندلر داخل ALS تا ادامه‌های async همین درخواست همان هویت را ببینند
    return new Observable((subscriber) => activityActorStorage.run(actor, () => run().subscribe(subscriber)));
  }
}

/** قالب مسیر (با :id) به‌جای مسیر واقعی — تا توکن/شناسه‌ی حساس در متادیتا نیاید. */
function normalizedPathForLog(routePattern: string): string {
  return '/' + normalizeRoutePath(routePattern).join('/');
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
