import { Injectable, Logger } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { ClientLogEntry } from './client/moodian-client.js';

/** ثبت لاگ فعالیت (ActivityLog) و لاگ فقط‌افزودنی ارسال (TaxSubmissionLog). هرگز راز/توکن/کلید در این ورودی‌ها نمی‌آید. */
@Injectable()
export class TaxAuditService {
  private readonly logger = new Logger('TaxAudit');

  /** ثبت یک تغییر. خطا در ثبت لاگ نباید عملیات اصلی را بشکند، ولی گزارش می‌شود. */
  async activity(ctx: TenantRequestContext, action: string, entityId: string | null, metadata?: Record<string, unknown>, entityType = 'TaxInvoice'): Promise<void> {
    try {
      const userId = await resolveTenantUserId(ctx).catch(() => null);
      await ctx.tenantDb.activityLog.create({ data: { userId: userId ?? undefined, action, entityType, entityId: entityId ?? undefined, metadata: (metadata ?? {}) as object } });
    } catch (e) {
      this.logger.warn(`audit write failed for ${action}: ${e instanceof Error ? e.message : e}`);
    }
  }

  async submission(ctx: TenantRequestContext, taxInvoiceId: string | null, entry: ClientLogEntry | { kind: string; ok: boolean; summary?: Record<string, unknown>; errorCode?: string }): Promise<void> {
    try {
      const userId = await resolveTenantUserId(ctx).catch(() => null);
      const e = entry as ClientLogEntry;
      await ctx.tenantDb.taxSubmissionLog.create({
        data: {
          taxInvoiceId: taxInvoiceId ?? undefined,
          kind: e.kind,
          ok: e.ok,
          requestTraceId: e.requestTraceId,
          httpStatus: e.httpStatus,
          errorCode: e.errorCode,
          summary: (e.summary ?? undefined) as object | undefined,
          userId: userId ?? undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`submission log write failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
