import { NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from './request-context.js';

/**
 * The JWT carries the GlobalUser id (identity spans tenants); most tenant
 * tables (Task.assignedUserId, ActivityLog.userId, ...) reference the
 * tenant-local User.id instead. This resolves one from the other.
 *
 * An API key isn't tied to any tenant User row — every field this feeds
 * (assignedUserId, ownerUserId, ActivityLog.userId, ...) is nullable
 * precisely for this case, so callers get null rather than a resolution
 * error for API-authenticated requests.
 */
export async function resolveTenantUserId(ctx: TenantRequestContext): Promise<string | null> {
  if (ctx.auth.type === 'api_key') return null;
  const user = await ctx.tenantDb.user.findUnique({
    where: { globalUserId: ctx.auth.sub },
    select: { id: true },
  });
  if (!user) throw new NotFoundException('کاربر در این محیط کاری یافت نشد');
  return user.id;
}
