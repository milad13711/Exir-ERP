import { BadRequestException, CallHandler, ConflictException, ExecutionContext, ForbiddenException, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { beginIdempotent, clampOfflineCreatedAt, hashRequest, MAX_OFFLINE_AGE_MS, packResponse, parseIdempotencyKey, parseOfflineMeta } from './idempotency.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { canStoreResponseBody, matchServerOp } from './server-ops.js';
import { IdempotencyStoreFactory } from './idempotency.store.js';
import { setOfflineMeta } from './offline-meta.js';
import { SyncPolicyService } from './sync-policy.service.js';
import { isStale, matchStaleRule, parseBaseUpdatedAt } from './stale-check.js';
import { roleAllowed } from './sync-policy.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MODULE_TTL_MS = 30_000;
/**
 * لایه‌ی سراسریِ ماژول «کار آفلاین و همگام‌سازی» (فقط برای تننت‌هایی که ماژول را دارند؛ وگرنه کاملاً بی‌اثر):
 *  ۱) Idempotency-Key روی POST/PUT/PATCH/DELETE → اجرای دقیقاً یک‌باره، بازپخش پاسخ با Idempotency-Replayed
 *  ۲) X-Offline-* → ثبت زمان/دستگاه در متادیتای لاگ فعالیت + اعمال سیاست (نقش، سن مجاز، عملیات فعال)
 *  ۳) X-Base-Updated-At → ۴۰۹ STALE برای ویرایش‌هایی که روی نسخه‌ی کهنه ساخته شده‌اند
 * بعد از گاردها اجرا می‌شود (req.ctx وجود دارد) و قبل از AuditInterceptor ثبت شده تا بازپخش، لاگ تکراری نسازد.
 * هیچ دیسپچر عمومی‌ای نیست: درخواست از همان خط لوله‌ی عادی (گارد/اعتبارسنجی/ممیزی) رد می‌شود.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');
  private readonly moduleCache = new Map<string, { at: number; ok: boolean }>();

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly stores: IdempotencyStoreFactory,
    private readonly policies: SyncPolicyService,
    private readonly permissions: PermissionsService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (!req || !MUTATING.has(req.method)) return next.handle();
    const ctx = req.ctx;
    if (!ctx) return next.handle();

    const h = req.headers as Record<string, unknown>;
    const rawKey = h['idempotency-key'];
    const hasOfflineHeaders = h['x-offline-created-at'] !== undefined || h['x-offline-op'] !== undefined || h['x-offline-device'] !== undefined;
    const hasBase = h['x-base-updated-at'] !== undefined;
    if (rawKey === undefined && !hasOfflineHeaders && !hasBase) return next.handle();

    if (!(await this.enabled(ctx.tenantId))) return next.handle(); // ماژول نصب نیست → هدرها نادیده

    const res = http.getResponse<Response>();
    res.setHeader('X-Server-Time', new Date().toISOString());

    // ── سیاست و فراداده‌ی آفلاین ──
    // همه‌ی مقادیر X-Offline-* «ادعای کلاینت» است: برای ممیزی ثبت می‌شود، مبنای مجوز یا ترتیب نیست.
    if (hasOfflineHeaders) {
      const policy = await this.policies.get(ctx);
      if (!roleAllowed(policy, ctx.auth.role)) throw new ForbiddenException({ message: 'کار آفلاین برای نقش شما در این سازمان فعال نیست', code: 'OFFLINE_ROLE_NOT_ALLOWED' });
      // op از روی مسیر+متد واقعی تعیین می‌شود (هدر X-Offline-Op نادیده)؛ عملیات خارج از رجیستری یا غیرفعال → رد
      const op = matchServerOp(req.method, req.path ?? '', req.body);
      if (!op || !policy.enabledOperations.includes(op)) {
        throw new ForbiddenException({ message: 'این عملیات برای ثبت آفلاین مجاز نیست یا توسط مدیر غیرفعال شده است', code: 'OFFLINE_OP_DISABLED' });
      }
      const isManager = ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
      const reviewedOk = h['x-offline-reviewed'] === '1' && isManager && policy.allowReviewedBeyondMax;
      const maxAgeMs = reviewedOk ? MAX_OFFLINE_AGE_MS : policy.maxOfflineDays * 86_400_000;
      const c = clampOfflineCreatedAt(h['x-offline-created-at'], Date.now(), maxAgeMs);
      if (!c.ok) {
        if (c.reason === 'invalid') throw new HttpException({ message: 'زمان ثبت آفلاین نامعتبر است', code: 'OFFLINE_DATE_INVALID' }, 422);
        throw new HttpException({ message: `این مورد بیش از ${policy.maxOfflineDays} روز پیش آفلاین ثبت شده و پذیرفته نمی‌شود؛ باید دوباره در حالت آنلاین ثبت شود`, code: 'OFFLINE_TOO_OLD' }, 422);
      }
    }
    const meta = parseOfflineMeta(h);
    if (meta) setOfflineMeta(req, meta);

    const key = parseIdempotencyKey(rawKey);
    if (rawKey !== undefined && !key) throw new BadRequestException({ message: 'کلید Idempotency نامعتبر است', code: 'IDEMPOTENCY_KEY_INVALID' });

    let claimId: string | null = null;
    const store = key ? this.stores.forTenant(ctx.tenantDb) : null;
    if (key && store) {
      const pathWithQuery = (req.originalUrl ?? req.url ?? '').slice(0, 2000);
      const decision = await beginIdempotent(store, {
        userId: ctx.auth.sub,
        key,
        method: req.method,
        path: (req.path ?? '').slice(0, 500),
        requestHash: hashRequest(req.method, pathWithQuery, req.body),
        offlineCreatedAt: meta?.createdAt ?? null,
        now: new Date(),
      });
      if (decision.kind === 'replay') {
        res.setHeader('Idempotency-Replayed', 'true');
        return of(decision.body ?? undefined);
      }
      if (decision.kind === 'reused') {
        throw new HttpException({ message: 'این کلید Idempotency قبلاً برای درخواست دیگری استفاده شده است', code: 'IDEMPOTENCY_KEY_REUSED' }, 422);
      }
      if (decision.kind === 'unknown') {
        throw new ConflictException({ message: 'نتیجه‌ی درخواست قبلی با این کلید نامشخص است؛ پیش از ارسال دوباره، رکورد را بررسی کنید', code: 'IDEMPOTENCY_RESULT_UNKNOWN' });
      }
      if (decision.kind === 'quota') {
        throw new HttpException({ message: 'سقف کلیدهای همگام‌سازی این کاربر پر شده است؛ بعداً دوباره تلاش کنید', code: 'IDEMPOTENCY_QUOTA' }, 429);
      }
      if (decision.kind === 'in-progress') {
        res.setHeader('Retry-After', '2');
        throw new ConflictException({ message: 'درخواست قبلی با همین کلید هنوز در حال پردازش است', code: 'IDEMPOTENCY_IN_PROGRESS' });
      }
      claimId = decision.id;
    }

    const release = async () => {
      if (claimId && store) await store.release(claimId).catch((e) => this.logger.warn(`release failed: ${e instanceof Error ? e.message : e}`));
    };

    // ── تعارض ویرایش (بعد از claim تا بازپخش یک درخواست موفق، «کهنه» حساب نشود) ──
    try {
      const base = parseBaseUpdatedAt(h['x-base-updated-at']);
      if (hasBase && !base) throw new BadRequestException({ message: 'X-Base-Updated-At نامعتبر است', code: 'BASE_INVALID' });
      if (base) {
        const rule = matchStaleRule(req.method, req.path ?? '');
        if (rule && (await this.mayEdit(ctx, rule.model))) {
          const current = await this.currentUpdatedAt(ctx.tenantDb, rule.model, rule.id);
          // محتوا/زمان رکورد در پاسخ نمی‌آید (اوراکل وجود)؛ کلاینت نسخه را با GET مجازشده می‌خواند
          if (current && isStale(current, base)) {
            throw new ConflictException({ message: 'این رکورد بعد از آخرین دریافت شما روی سرور تغییر کرده است', code: 'STALE' });
          }
        }
      }
    } catch (err) {
      await release();
      throw err;
    }

    if (!claimId || !store) return next.handle();
    const id = claimId;
    return next.handle().pipe(
      mergeMap((value) =>
        from(
          (async () => {
            const packed = packResponse(value, { storeBody: canStoreResponseBody(req.method, req.path ?? '') });
            let saved = false;
            for (let i = 0; i < 2 && !saved; i += 1) {
              try {
                await store.complete(id, { responseStatus: res.statusCode || 200, responseBody: packed.body, resourceId: packed.resourceId });
                saved = true;
              } catch (e) {
                if (i === 1) this.logger.warn(`complete failed: ${e instanceof Error ? e.message : e}`);
              }
            }
            // ذخیره‌ی نتیجه ناموفق: ردیف PENDING نماند و دوباره اجرا نشود
            if (!saved) await store.markUnknown(id).catch(() => undefined);
            return value;
          })(),
        ),
      ),
      catchError((err) => from(release()).pipe(mergeMap(() => { throw err; }))),
    );
  }

  private async enabled(tenantId: string): Promise<boolean> {
    const now = Date.now();
    const hit = this.moduleCache.get(tenantId);
    if (hit && now - hit.at < MODULE_TTL_MS) return hit.ok;
    let ok = false;
    try {
      ok = await isModuleEnabled(this.controlDb, tenantId, 'offline-sync');
    } catch {
      ok = false;
    }
    this.moduleCache.set(tenantId, { at: now, ok });
    return ok;
  }

  private async mayEdit(ctx: NonNullable<Request['ctx']>, model: 'crmContact' | 'task' | 'dailyChecklistItem'): Promise<boolean> {
    const code = model === 'crmContact' ? 'crm' : model === 'task' ? 'tasks' : 'daily-checklist';
    try {
      return (await this.permissions.getEffective(ctx, code)).canEdit;
    } catch {
      return false;
    }
  }

  private async currentUpdatedAt(db: NonNullable<Request['ctx']>['tenantDb'], model: 'crmContact' | 'task' | 'dailyChecklistItem', id: string): Promise<Date | null> {
    const where = { where: { id }, select: { updatedAt: true } } as const;
    const row =
      model === 'crmContact' ? await db.crmContact.findUnique(where) : model === 'task' ? await db.task.findUnique(where) : await db.dailyChecklistItem.findUnique(where);
    return row?.updatedAt ?? null;
  }
}
