import { ForbiddenException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getSubordinateUserIds } from '../hr/org-chain.util.js';
import type { PermissionsService } from '../permissions/permissions.service.js';

/**
 * سلسله‌مراتب دید گزارش‌ها (ماژول «گزارش‌ها»):
 *
 *  - OWNER/ADMIN: همه‌ی گزارش‌ها.
 *  - «فقط خودم» (canViewOwn): گزارش‌هایی که خودش نوشته + گزارش‌هایی که صراحتاً به او ارجاع شده.
 *  - «مشاهده‌ی همه» (canViewAll): همان‌ها + گزارش‌های زیردستان (همه‌ی سطوح زنجیره‌ی مدیریتی و اعضای
 *    واحدی که مدیرشان است — org-chain.util). هرگز گزارشِ بالادست، همتا یا شاخه‌ی نامرتبط را نمی‌بیند
 *    و گزارش بی‌صاحب (سیستمی) را فقط دارندگان «مشاهده‌ی همه» می‌بینند.
 *  - گزارشِ «دانش سازمانی» (isKnowledge) را کسی که دسترسی مشاهده دارد می‌بیند — تبدیل آن عمداً انجام شده.
 *
 * کاربر بدون شناسه‌ی کاربری تننت (کلید API غیرمدیر) هیچ دامنه‌ای ندارد؛ وگرنه `createdByUserId: null`
 * با گزارش‌های بی‌صاحب یکی می‌شد.
 */
export async function reportAuthorIds(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
): Promise<{ manager: boolean; userId?: string; viewAll: boolean; authorIds: string[] }> {
  if (ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN') return { manager: true, viewAll: true, authorIds: [] };
  const matrix = await permissions.getEffective(ctx, 'reports');
  if (!matrix.canViewAll && !matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const userId = await resolveTenantUserId(ctx);
  if (!userId) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const subordinates = matrix.canViewAll ? await getSubordinateUserIds(ctx.tenantDb, userId) : [];
  return { manager: false, userId, viewAll: matrix.canViewAll, authorIds: [userId, ...subordinates] };
}

/** where برای خواندن (فهرست/جزئیات/پیوست‌ها). `{}` فقط برای مدیر. */
export async function reportScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const a = await reportAuthorIds(permissions, ctx);
  if (a.manager) return {};
  return {
    OR: [
      { createdByUserId: { in: a.authorIds } },
      { referrals: { some: { toUserId: a.userId } } },
      { isKnowledge: true },
      ...(a.viewAll ? [{ createdByUserId: null }] : []),
    ],
  };
}

/**
 * where برای تغییر (ویرایش/حذف/بایگانی/ارجاع): فقط نویسنده یا مدیرِ بالادستِ نویسنده؛
 * گیرنده‌ی ارجاع یا گزارش دانش سازمانی به‌تنهایی حق تغییر نمی‌دهد.
 */
export async function reportEditScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const a = await reportAuthorIds(permissions, ctx);
  if (a.manager) return {};
  return { createdByUserId: { in: a.authorIds } };
}
