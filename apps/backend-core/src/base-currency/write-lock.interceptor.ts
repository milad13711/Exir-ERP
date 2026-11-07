import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';
import { isBlockedDuringConversion, writeLock } from './write-lock.js';

const MESSAGE = 'تغییر ارز پایه در حال انجام است؛ ثبت و ویرایش اسناد مالی موقتاً متوقف است. چند دقیقه دیگر دوباره تلاش کنید.';
const DB_CHECK_MS = 5_000;
const STALE_HEARTBEAT_MS = 2 * 60_000;

function publicSlug(req: Request): string | undefined {
  const s = (req.params as Record<string, string> | undefined)?.slug;
  return typeof s === 'string' && s ? s : undefined;
}

/**
 * هنگام تبدیل ارز پایه، نوشتن‌های مالی همان تننت را با ۴۲۳ رد می‌کند و درخواست‌های مالیِ در جریان را می‌شمارد
 * (تا سرویس پس از قفل‌کردن، تخلیه‌شدنشان را صبر کند). مسیرهای عمومی با :slug فقط برای همان تننت قفل می‌شوند؛
 * اگر تننت از مسیر قابل تشخیص نباشد مسدود نمی‌شود.
 */
@Injectable()
export class BaseCurrencyWriteLockInterceptor implements NestInterceptor {
  private readonly dbCache = new Map<string, { at: number; locked: boolean }>();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl ?? req.url ?? req.path ?? '';
    if (!isBlockedDuringConversion(req.method, path)) return next.handle();

    const ctx = req.ctx;
    let key: string;
    if (ctx) {
      if (writeLock.isLocked(ctx.tenantId)) throw new HttpException(MESSAGE, 423);
      if (await this.dbLocked(ctx)) throw new HttpException(MESSAGE, 423);
      key = ctx.tenantId;
    } else {
      const slug = publicSlug(req);
      if (!slug) return next.handle(); // تننت نامشخص ⇒ مسدود نمی‌کنیم
      if (writeLock.isSlugLocked(slug)) throw new HttpException(MESSAGE, 423);
      key = writeLock.slugKey(slug);
    }
    const leave = writeLock.enter(key);
    return next.handle().pipe(finalize(leave));
  }

  private async dbLocked(ctx: NonNullable<Request['ctx']>): Promise<boolean> {
    const hit = this.dbCache.get(ctx.tenantId);
    if (hit && Date.now() - hit.at < DB_CHECK_MS) return hit.locked;
    let locked = false;
    try {
      locked = (await ctx.tenantDb.baseCurrencyConversion.count({ where: { status: 'RUNNING', heartbeatAt: { gt: new Date(Date.now() - STALE_HEARTBEAT_MS) } } })) > 0;
    } catch {
      locked = false; // جدول هنوز مهاجرت نشده
    }
    this.dbCache.set(ctx.tenantId, { at: Date.now(), locked });
    return locked;
  }
}
