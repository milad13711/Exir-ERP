import { ForbiddenException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from './permissions.service.js';

/**
 * Module-specific "own" scopes that are richer than a single owner column.
 * Shared by the module controllers and by the generic attachments endpoint so
 * both enforce exactly the same visibility.
 */

/** «مشاهده‌ی همه» = همه‌ی قراردادها؛ «فقط خودم» = قراردادهایی که خودش ساخته، امضای شرکتشان به او ارجاع شده یا قرارداد داخلی خودش است. */
export async function contractScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const matrix = await permissions.getEffective(ctx, 'contracts');
  if (matrix.canViewAll) return {};
  if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const userId = await resolveTenantUserId(ctx);
  return { OR: [{ createdByUserId: userId }, { referredSignerUserId: userId }, { employee: { userId } }] };
}

/** «فقط خودم» = پروژه‌هایی که کاربر مدیر، سازنده، عضو تیم یا مسئول یکی از مراحلشان است. */
export async function projectScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const matrix = await permissions.getEffective(ctx, 'projects');
  if (matrix.canViewAll) return {};
  if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const userId = await resolveTenantUserId(ctx);
  return {
    OR: [
      { managerUserId: userId },
      { createdByUserId: userId },
      { members: { some: { userId } } },
      { stages: { some: { responsibleUserId: userId } } },
    ],
  };
}
