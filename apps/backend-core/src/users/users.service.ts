import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

@Injectable()
export class UsersService {
  constructor(private readonly controlDb: ControlPrismaService) {}

  async listUsers(ctx: TenantRequestContext) {
    const users = await ctx.tenantDb.user.findMany({
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      status: u.status,
      roles: u.roles.map((r) => r.role.name),
    }));
  }

  async listRoles(ctx: TenantRequestContext) {
    return ctx.tenantDb.role.findMany({
      include: { permissions: { include: { permission: true } }, modulePermissions: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * A brand-new role always starts with no ModulePermission rows (no
   * access anywhere) — same shape `listRoles` returns, so the caller can
   * feed the result straight into the same permission-matrix editor used
   * for existing roles, no separate "new role" UI needed.
   */
  async createRole(ctx: TenantRequestContext, name: string) {
    const existing = await ctx.tenantDb.role.findUnique({ where: { name } });
    if (existing) throw new ConflictException('نقشی با این نام از قبل وجود دارد');
    return ctx.tenantDb.role.create({
      data: { name, isSystem: false },
      include: { permissions: { include: { permission: true } }, modulePermissions: true },
    });
  }

  /** System roles (seeded per tenant, e.g. "مدیر سیستم") can never be removed — everything else can. */
  async deleteRole(ctx: TenantRequestContext, roleId: string) {
    const role = await ctx.tenantDb.role.findUniqueOrThrow({ where: { id: roleId } });
    if (role.isSystem) throw new ForbiddenException('نقش‌های پیش‌فرض سیستم قابل حذف نیستند');
    await ctx.tenantDb.role.delete({ where: { id: roleId } });
    return { success: true };
  }

  /**
   * Replaces a role's whole access matrix at once — the Settings → Roles
   * page always sends the full grid, so upsert-per-module is simplest and
   * avoids having to diff against what was there before.
   */
  async updateModulePermissions(
    ctx: TenantRequestContext,
    roleId: string,
    entries: Array<{
      moduleCode: string;
      canViewAll: boolean;
      canViewOwn: boolean;
      canCreate: boolean;
      canEdit: boolean;
      canDelete: boolean;
    }>,
  ) {
    await ctx.tenantDb.role.findUniqueOrThrow({ where: { id: roleId } });
    await ctx.tenantDb.$transaction(
      entries.map((entry) =>
        ctx.tenantDb.modulePermission.upsert({
          where: { roleId_moduleCode: { roleId, moduleCode: entry.moduleCode } },
          create: { roleId, ...entry },
          update: { ...entry },
        }),
      ),
    );
    return ctx.tenantDb.modulePermission.findMany({ where: { roleId } });
  }

  async inviteUser(ctx: TenantRequestContext, name: string, phone: string, roleId: string) {
    const globalUser = await this.controlDb.globalUser.upsert({
      where: { phone },
      create: { phone, name },
      update: {},
    });

    await this.controlDb.tenantMembership.upsert({
      where: { tenantId_globalUserId: { tenantId: ctx.tenantId, globalUserId: globalUser.id } },
      create: { tenantId: ctx.tenantId, globalUserId: globalUser.id, role: 'MEMBER' },
      update: {},
    });

    const user = await ctx.tenantDb.user.upsert({
      where: { globalUserId: globalUser.id },
      create: {
        globalUserId: globalUser.id,
        name,
        phone,
        status: 'INVITED',
        roles: { create: [{ roleId }] },
      },
      update: {
        roles: { create: [{ roleId }] },
      },
    });

    const actorTenantUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    await ctx.tenantDb.activityLog.create({
      data: {
        userId: actorTenantUserId,
        action: 'user.invited',
        entityType: 'User',
        entityId: user.id,
        metadata: { phone, roleId },
      },
    });

    return user;
  }
}
