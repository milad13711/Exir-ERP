import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import type { ActorFacts } from './dispatch-scope.js';

export const shipmentLink = (id: string) => `/dispatch/${id}`;

export type Actor = ActorFacts & { name: string };

export const isManagerCtx = (ctx: TenantRequestContext) => ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';

/** هویت کاربر جاری برای ثبت در تایم‌لاین: شناسه، نام، نقش‌ها و مدیر بودن. کلید API شناسه ندارد. */
export async function resolveActor(ctx: TenantRequestContext): Promise<Actor> {
  const manager = isManagerCtx(ctx);
  const userId = await resolveTenantUserId(ctx).catch(() => null);
  if (!userId) return { userId: null, name: manager ? 'مدیر' : 'سیستم', roleIds: [], manager };
  const [user, roles] = await Promise.all([
    ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ctx.tenantDb.userRole.findMany({ where: { userId }, select: { roleId: true } }),
  ]);
  return { userId, name: user?.name ?? 'کاربر', roleIds: roles.map((r) => r.roleId), manager };
}

/** «دسترسی مدیر» = مالک/ادمین یا ماتریس dispatch با تیک حذف (برای عبور از دروازه‌ها و ویرایش وزن). */
export async function canOverride(permissions: PermissionsService, ctx: TenantRequestContext): Promise<boolean> {
  if (isManagerCtx(ctx)) return true;
  const m = await permissions.getEffective(ctx, 'dispatch');
  return m.canDelete;
}

export async function assertCanOverride(permissions: PermissionsService, ctx: TenantRequestContext): Promise<void> {
  if (!(await canOverride(permissions, ctx))) throw new ForbiddenException('برای این کار دسترسی مدیر ماژول اعلام بار لازم است');
}

export type EventInput = {
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: { userId: string | null; name: string } | null;
  note?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown>;
};

/** یک رویداد تایم‌لاین ثبت می‌کند (چه کسی/چه چیزی/کی/از→به/دلیل). actor خالی = سیستم یا راننده. */
export async function logEvent(db: TenantPrismaClient, shipmentId: string, e: EventInput): Promise<void> {
  await db.shipmentEvent.create({
    data: {
      shipmentId,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actorUserId: e.actor?.userId ?? null,
      actorName: e.actor?.name ?? null,
      note: e.note ?? null,
      reason: e.reason ?? null,
      meta: (e.meta as never) ?? undefined,
    },
  });
}

export const dedupe = <T>(xs: T[]): T[] => [...new Set(xs)];

export const fmtKg = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} kg`);
