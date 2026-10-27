import { NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getSubordinateUserIds } from '../hr/org-chain.util.js';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { PermissionsService } from '../permissions/permissions.service.js';

/**
 * سطح دسترسی بیننده به آرشیو فعالیت یک کاربر:
 *  - self  : خودِ کاربر — آرشیو کامل (شامل IP/دستگاه خودش)
 *  - admin : OWNER/ADMIN — هر کاربری (شامل کاربران خروج‌کرده/ناشناس‌شده) + IP/دستگاه + CSV
 *  - hr    : مدیر منابع انسانی (hr.canViewAll ⇒ هر کارمند) یا مدیر سلسله‌مراتبی (زیردستان در org-chain)
 *            — بدون IP/دستگاه؛ هرگز برای مالک/مدیر سیستم.
 * هر حالت دیگر: ۴۰۴ (وجود کاربر لو نمی‌رود).
 */
export type ArchiveLevel = 'self' | 'admin' | 'hr';

export type ArchiveAccess = {
  level: ArchiveLevel;
  viewerId: string | null;
  target: { id: string; name: string; status: string; globalUserId: string } | null;
  /** کاربر هدف دیگر در سیستم نیست ولی ردپایی از خروجش (UserOffboardingRun) هست */
  tombstone: { name: string } | null;
  canSeeNetwork: boolean;
  canExport: boolean;
  canSeeLabels: boolean;
};

const NOT_FOUND = () => new NotFoundException('کاربر یافت نشد');

export async function resolveArchiveAccess(
  ctx: TenantRequestContext,
  targetId: string,
  deps: { permissions: Pick<PermissionsService, 'getEffective'>; controlDb: Pick<ControlPrismaService, 'tenantMembership'> },
): Promise<ArchiveAccess> {
  // کلید API هویت کاربری ندارد
  if (ctx.auth.type === 'api_key') throw NOT_FOUND();
  const viewerId = await resolveTenantUserId(ctx).catch(() => null);
  const isAdmin = ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
  const target = await ctx.tenantDb.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, status: true, globalUserId: true } });

  const build = (level: ArchiveLevel): ArchiveAccess => ({
    level,
    viewerId,
    target,
    tombstone: null,
    canSeeNetwork: level === 'admin' || level === 'self',
    canExport: level === 'admin' || level === 'hr',
    canSeeLabels: level === 'admin' || level === 'self',
  });

  if (!target) {
    // ردیف کاربر حذف شده (حذف کامل بدون سابقه) — فقط مدیر و فقط اگر گزارش خروج دارد
    if (!isAdmin) throw NOT_FOUND();
    const run = await ctx.tenantDb.userOffboardingRun.findFirst({ where: { fromUserId: targetId }, orderBy: { createdAt: 'desc' }, select: { fromUserName: true } });
    if (!run) throw NOT_FOUND();
    return { ...build('admin'), target: null, tombstone: { name: run.fromUserName } };
  }

  if (viewerId && viewerId === targetId) return build('self');
  if (isAdmin) return build('admin');
  if (!viewerId) throw NOT_FOUND();

  // مالک/مدیر سیستم فقط برای خودشان و مدیران قابل‌مشاهده است
  if (!target.globalUserId.startsWith('deleted:')) {
    const m = await deps.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: ctx.tenantId, globalUserId: target.globalUserId } },
      select: { role: true },
    });
    if (m && (m.role === 'OWNER' || m.role === 'ADMIN')) throw NOT_FOUND();
  }

  const hr = await deps.permissions.getEffective(ctx, 'hr');
  if (!hr.canViewAll && !hr.canViewOwn) throw NOT_FOUND();
  const employee = await ctx.tenantDb.employee.findUnique({ where: { userId: targetId }, select: { id: true } });
  if (!employee) throw NOT_FOUND();
  if (hr.canViewAll) return build('hr');
  const subordinates = await getSubordinateUserIds(ctx.tenantDb, viewerId);
  if (!subordinates.includes(targetId)) throw NOT_FOUND();
  return build('hr');
}
