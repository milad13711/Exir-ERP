import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { canManageTask, resolveTaskRole, taskScopeWhere } from './task-scope.js';

/** انواع پیوستِ گردش‌کار وظایف: خودِ وظیفه، نتیجه‌ی ثبت‌شده، و گزارش مشکل. */
export const TASK_ATTACHMENT_ENTITIES: ReadonlySet<string> = new Set(['Task', 'TaskResult', 'TaskComment']);

/**
 * دسترسی به پیوست‌های وظیفه = دسترسی به خودِ وظیفه (همان دامنه‌ی «سازنده/ارجاع‌گیرنده»؛ خارج از دامنه ۴۰۴).
 * نوشتن/حذف: پیوست‌های خودِ وظیفه فقط سازنده/مدیر؛ پیوست نتیجه/مشکل فقط نویسنده‌ی همان (یا سازنده/مدیر برای حذف).
 * (مدیران OWNER/ADMIN قبل از رسیدن به این تابع در AttachmentAccessService رد می‌شوند.)
 */
export async function assertTaskAttachmentAccess(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
  entityType: string,
  entityId: string,
  mode: 'read' | 'write' | 'delete',
): Promise<void> {
  const matrix = await permissions.getEffective(ctx, 'tasks');
  if (!matrix.canViewAll && !matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی دسترسی به پیوست‌های این بخش را ندارید');
  const me = await resolveTenantUserId(ctx);

  let taskId = entityId;
  let authorUserId: string | null = null;
  if (entityType === 'TaskResult') {
    const r = await ctx.tenantDb.taskResult.findUnique({ where: { id: entityId }, select: { taskId: true, authorUserId: true } });
    if (!r) throw new NotFoundException('رکورد یافت نشد');
    taskId = r.taskId;
    authorUserId = r.authorUserId;
  } else if (entityType === 'TaskComment') {
    const c = await ctx.tenantDb.taskComment.findUnique({ where: { id: entityId }, select: { taskId: true, authorUserId: true } });
    if (!c) throw new NotFoundException('رکورد یافت نشد');
    taskId = c.taskId;
    authorUserId = c.authorUserId;
  }

  const task = await ctx.tenantDb.task.findFirst({
    where: { id: taskId, ...taskScopeWhere(matrix.canViewAll, me) },
    select: { id: true, createdByUserId: true, assignedUserId: true, assignees: { select: { userId: true } } },
  });
  if (!task) throw new NotFoundException('رکورد یافت نشد');
  if (mode === 'read') return;

  const role = resolveTaskRole(task, me, matrix.canViewAll);
  if (canManageTask(role)) return;
  if (entityType !== 'Task' && authorUserId && authorUserId === me && mode === 'write') return;
  throw new ForbiddenException('اجازه‌ی ویرایش پیوست‌های این وظیفه را ندارید');
}
