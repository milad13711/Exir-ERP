import { ForbiddenException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from '../permissions/permissions.service.js';

/**
 * «مشاهده‌ی همه» = همه‌ی فرم‌ها؛ «فقط خودم» = فرم‌هایی که خودش ساخته.
 * پاسخ‌ها (FormSubmission) همیشه از طریق فرمشان scope می‌شوند: `{ form: formScope }`.
 * کاربر بدون شناسه‌ی کاربری تننت (مثلاً کلید API غیرمدیر) هرگز دامنه‌ی «خودم» ندارد —
 * وگرنه `createdByUserId: null` با فرم‌های بی‌صاحب یکی می‌شد.
 */
export async function formScope(permissions: PermissionsService, ctx: TenantRequestContext): Promise<Record<string, unknown>> {
  const matrix = await permissions.getEffective(ctx, 'forms');
  if (matrix.canViewAll) return {};
  if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  const userId = await resolveTenantUserId(ctx);
  if (!userId) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  return { createdByUserId: userId };
}
