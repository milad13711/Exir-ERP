import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

/** مسیرهایی که ثبت‌شان نویز است یا خودشان لاگ اختصاصی دارند. */
const IGNORED_FIRST_SEGMENTS = new Set(['auth', 'notifications', 'voip', 'me', 'push', 'workspace', 'public', 'admin', 'support', 'offline-sync']);
const VERBS: Record<string, string> = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' };
// عمل‌های POST که «ایجاد» نیستند — برچسب دقیق‌تر
const POST_ACTIONS: Record<string, string> = { approve: 'approved', reject: 'rejected', confirm: 'confirmed', cancel: 'cancelled', void: 'voided', post: 'posted', decision: 'decided', sign: 'signed', receive: 'received', complete: 'completed', hire: 'hired' };

/**
 * ثبت خودکار همه‌ی تغییرات کاربران (ایجاد/ویرایش/حذف/تأیید/ابطال) در لاگ فعالیت — تا مدیر
 * بدون تغییر در تک‌تک ماژول‌ها بداند «چه کسی، چه چیزی را، کِی» تغییر داده است.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const verb = VERBS[req.method];
    if (!verb) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const ctx = req.ctx;
        if (!ctx) return;
        const path = (req.path ?? '').replace(/^\/api\//, '').replace(/^\//, '');
        const segments = path.split('/').filter(Boolean);
        if (segments.length === 0 || IGNORED_FIRST_SEGMENTS.has(segments[0])) return;

        const isId = (s: string) => /^[0-9a-f-]{20,}$/i.test(s) || /^\d+$/.test(s);
        const nameSegments = segments.filter((s) => !isId(s));
        const last = nameSegments[nameSegments.length - 1];
        const action = req.method === 'POST' && last && POST_ACTIONS[last] ? POST_ACTIONS[last] : verb;
        const moduleName = nameSegments[0];
        const entity = nameSegments.slice(1).filter((s) => !POST_ACTIONS[s]).join('.') || 'record';
        const entityId = segments.find(isId) ?? null;

        void ctx.tenantDb.user
          .findFirst({ where: { globalUserId: ctx.auth.sub }, select: { id: true } })
          .then((user) =>
            ctx.tenantDb.activityLog.create({
              data: {
                userId: user?.id,
                action: `${moduleName}.${entity}.${action}`,
                entityType: entity,
                entityId,
                metadata: { method: req.method, path },
              },
            }),
          )
          .catch((err) => this.logger.warn(`audit log failed: ${err instanceof Error ? err.message : err}`));
      }),
    );
  }
}
