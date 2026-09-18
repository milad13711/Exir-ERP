import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
  ) {}

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
      roleIds: u.roles.map((r) => r.roleId),
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

    await this.sendAccessGrantedSms(ctx, name, phone);

    return user;
  }

  /** نام، ایمیل، وضعیت و نقش‌های یک کاربر را ویرایش می‌کند — roleIds در صورت ارسال، کل نقش‌های قبلی را جایگزین می‌کند. */
  async updateUser(
    ctx: TenantRequestContext,
    id: string,
    data: { name?: string; email?: string | null; status?: 'INVITED' | 'ACTIVE' | 'DISABLED'; roleIds?: string[] },
  ) {
    await ctx.tenantDb.user.findUniqueOrThrow({ where: { id } });

    if (data.roleIds) {
      await ctx.tenantDb.userRole.deleteMany({ where: { userId: id } });
    }
    return ctx.tenantDb.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        status: data.status,
        roles: data.roleIds ? { create: data.roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      include: { roles: { include: { role: true } } },
    });
  }

  /**
   * حذف کامل دسترسی کاربر — هم ردیف محلی تننت و هم عضویتش در کنترل‌پلین
   * حذف می‌شود تا واقعاً دیگر عضو این تننت نباشد، نه فقط غیرفعال. مالک
   * تننت و خودِ کاربر جاری قابل حذف نیستند.
   */
  async deleteUser(ctx: TenantRequestContext, id: string) {
    const actorUserId = await resolveTenantUserId(ctx).catch(() => null);
    if (actorUserId === id) throw new ForbiddenException('نمی‌توانید حساب کاربری خودتان را حذف کنید');

    const user = await ctx.tenantDb.user.findUniqueOrThrow({ where: { id } });
    const membership = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: ctx.tenantId, globalUserId: user.globalUserId } },
    });
    if (membership?.role === 'OWNER') throw new ForbiddenException('مالک تننت قابل حذف نیست');

    await ctx.tenantDb.user.delete({ where: { id } });
    if (membership) {
      await this.controlDb.tenantMembership.delete({ where: { id: membership.id } });
    }
    return { success: true };
  }

  /**
   * Login here is phone+OTP only (no password), so the new user has no
   * credential to receive — this just tells them access exists and where
   * to use it. Same phone can hold access in several tenants (it's
   * INVITED/grantSystemAccess per-tenant), so the tenant name is included
   * to disambiguate which business this message is about.
   */
  private async sendAccessGrantedSms(ctx: TenantRequestContext, name: string, phone: string) {
    if (!this.sms.isConfigured()) return;
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    const loginUrl = `${(process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '')}/login`;
    const businessLabel = tenant?.name ? ` در «${tenant.name}»` : '';
    const message = `${name} عزیز، دسترسی شما به سیستم${businessLabel} در اکسیر ERP فعال شد. برای ورود با همین شماره موبایل به آدرس زیر مراجعه کنید:\n${loginUrl}`;
    const result = await this.sms.sendSms(phone, message);
    if (!result.success) {
      await this.controlDb.errorLog.create({
        data: {
          service: 'backend-core',
          level: 'ERROR',
          message: `ارسال پیامک فعال‌سازی دسترسی ناموفق بود: ${result.error}`,
          context: { phone, tenantId: ctx.tenantId },
        },
      });
    }
  }
}
