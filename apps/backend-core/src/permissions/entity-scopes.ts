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

/**
 * «مشاهده‌ی همه» = همه‌ی پروپوزال‌ها؛ «فقط خودم» = پروپوزال‌هایی که خودش ساخته یا برای پیگیری به او ارجاع شده
 * (assignedUserId). همین یک تابع هم در کنترلر پروپوزال و هم در دسترسی پیوست‌ها استفاده می‌شود.
 * کاربر بدون شناسه‌ی کاربری تننت (مثلاً کلید API غیرمدیر) هرگز دامنه‌ی «خودم» ندارد — وگرنه
 * `createdByUserId: null` با رکوردهای بی‌صاحب یکی می‌شد.
 */
export async function proposalScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const matrix = await permissions.getEffective(ctx, 'proposals');
  if (matrix.canViewAll) return {};
  if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const userId = await resolveTenantUserId(ctx);
  if (!userId) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  return { OR: [{ createdByUserId: userId }, { assignedUserId: userId }] };
}

/**
 * «مشاهده‌ی همه» = همه‌ی صورتحساب‌های مالیاتی؛ «فقط خودم» = آن‌هایی که خودش ساخته یا درخواست تأیید داده.
 * کاربر بدون شناسه‌ی تننت (کلید API غیرمدیر) دامنه‌ی «خودم» ندارد.
 */
export async function taxInvoiceScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const matrix = await permissions.getEffective(ctx, 'tax');
  if (matrix.canViewAll) return {};
  if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const userId = await resolveTenantUserId(ctx);
  if (!userId) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  return { OR: [{ createdByUserId: userId }, { requestedByUserId: userId }] };
}
