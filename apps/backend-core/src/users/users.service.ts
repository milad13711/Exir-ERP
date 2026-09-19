import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

const ROLE_RANK = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const;
type MembershipRole = keyof typeof ROLE_RANK;

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // حذف کاربر بدون تأیید مدیر نهایی نمی‌شود — درخواست در کارتابل مدیر می‌نشیند.
    this.approvals.registerHandler('USER_DELETION', {
      approve: async (ctx, userId, opts) => {
        if (opts.requestedByUserId && opts.requestedByUserId === (await resolveTenantUserId(ctx).catch(() => null)) && ctx.auth.role !== 'OWNER') {
          throw new ForbiddenException('درخواست‌دهنده نمی‌تواند حذف درخواستی خودش را تأیید کند');
        }
        await this.executeDelete(ctx, userId);
      },
      reject: async () => undefined,
    });
  }

  /** نقش مدیریتی (سطح عضویت) یک کاربر تننت: OWNER > ADMIN > MEMBER. */
  private async membershipRoleOf(ctx: TenantRequestContext, userId: string): Promise<{ role: MembershipRole; membershipId: string | null; globalUserId: string }> {
    const user = await ctx.tenantDb.user.findUniqueOrThrow({ where: { id: userId } });
    const membership = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: ctx.tenantId, globalUserId: user.globalUserId } },
    });
    return { role: (membership?.role ?? 'MEMBER') as MembershipRole, membershipId: membership?.id ?? null, globalUserId: user.globalUserId };
  }

  async listUsers(ctx: TenantRequestContext) {
    const users = await ctx.tenantDb.user.findMany({
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: { tenantId: ctx.tenantId, globalUserId: { in: users.map((u) => u.globalUserId) } },
      select: { globalUserId: true, role: true },
    });
    const roleByGlobal = new Map(memberships.map((m) => [m.globalUserId, m.role]));
    return users.map((u) => ({
      membershipRole: roleByGlobal.get(u.globalUserId) ?? 'MEMBER',
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

  async getUserPermissionOverrides(ctx: TenantRequestContext, id: string) {
    await ctx.tenantDb.user.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.userModulePermission.findMany({ where: { userId: id } });
  }

  /** کل مجموعه‌ی دسترسی‌های دستی کاربر را جایگزین می‌کند؛ ماژولی که در entries نباشد به ارث‌بری از نقش برمی‌گردد. */
  async setUserPermissionOverrides(
    ctx: TenantRequestContext,
    id: string,
    entries: Array<{ moduleCode: string; canViewAll: boolean; canViewOwn: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }>,
  ) {
    await ctx.tenantDb.user.findUniqueOrThrow({ where: { id } });
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.userModulePermission.deleteMany({ where: { userId: id } }),
      ...entries.map((e) => ctx.tenantDb.userModulePermission.create({ data: { userId: id, ...e } })),
    ]);
    return ctx.tenantDb.userModulePermission.findMany({ where: { userId: id } });
  }

  /**
   * درخواست حذف کاربر. فقط مدیر بالادستی می‌تواند کاربر پایین‌دستی را حذف کند
   * (مالک بر همه، ادمین فقط بر اعضای عادی) و مدیر اصلی (OWNER) هرگز حذف نمی‌شود.
   * حذف توسط ادمین ابتدا به کارتابل مدیر می‌رود؛ خودِ مالک (مدیر نهایی) مستقیم حذف می‌کند.
   */
  async deleteUser(ctx: TenantRequestContext, id: string) {
    const actorUserId = await resolveTenantUserId(ctx).catch(() => null);
    if (actorUserId === id) throw new ForbiddenException('نمی‌توانید حساب کاربری خودتان را حذف کنید');

    const target = await this.membershipRoleOf(ctx, id);
    if (target.role === 'OWNER') throw new ForbiddenException('مدیر اصلی سیستم قابل حذف نیست؛ ابتدا باید نقش مدیر کل او تغییر کند');
    const actorRank = ROLE_RANK[ctx.auth.role as MembershipRole] ?? 0;
    if (actorRank <= ROLE_RANK[target.role]) {
      throw new ForbiddenException('فقط مدیر بالادستی می‌تواند دسترسی کاربر پایین‌دستی را حذف کند');
    }

    if (ctx.auth.role === 'OWNER') {
      await this.executeDelete(ctx, id);
      return { success: true, pendingApproval: false };
    }

    const user = await ctx.tenantDb.user.findUniqueOrThrow({ where: { id } });
    await this.approvals.request(ctx, {
      moduleCode: 'users',
      entityType: 'USER_DELETION',
      entityId: id,
      title: `حذف کاربر «${user.name}»`,
      summary: 'درخواست حذف دسترسی این کاربر ثبت شده و منتظر تأیید مدیر است.',
      link: '/settings/users',
      requestedByUserId: actorUserId ?? undefined,
    });
    return { success: true, pendingApproval: true };
  }

  /** حذف واقعی — هم ردیف محلی تننت و هم عضویت کنترل‌پلین. فقط از مسیرهای تأییدشده صدا زده می‌شود. */
  private async executeDelete(ctx: TenantRequestContext, id: string) {
    const target = await this.membershipRoleOf(ctx, id);
    if (target.role === 'OWNER') throw new ForbiddenException('مدیر اصلی سیستم قابل حذف نیست');
    if ((ROLE_RANK[ctx.auth.role as MembershipRole] ?? 0) <= ROLE_RANK[target.role]) {
      throw new ForbiddenException('فقط مدیر بالادستی می‌تواند دسترسی کاربر پایین‌دستی را حذف کند');
    }
    await ctx.tenantDb.user.delete({ where: { id } });
    if (target.membershipId) await this.controlDb.tenantMembership.delete({ where: { id: target.membershipId } });
    await this.approvals.closeForEntity(ctx, 'USER_DELETION', id, 'APPROVED');
  }

  /**
   * تعیین سطح مدیریتی یک کاربر — فقط مالک. «انتقال» یعنی نقش مدیر کل به کاربر دیگر
   * داده شود و خودِ مالک به ادمین تنزل یابد؛ بدون transfer، نقش OWNER به کاربر دوم هم داده
   * می‌شود (دسترسی همتراز). همیشه باید حداقل یک مالک بماند.
   */
  async setManagementRole(ctx: TenantRequestContext, id: string, role: MembershipRole, transfer: boolean) {
    if (ctx.auth.role !== 'OWNER') throw new ForbiddenException('فقط مدیر کل می‌تواند سطح مدیریتی کاربران را تغییر دهد');
    const actorUserId = await resolveTenantUserId(ctx).catch(() => null);
    const target = await this.membershipRoleOf(ctx, id);
    if (!target.membershipId) throw new BadRequestException('عضویت این کاربر یافت نشد');

    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await this.controlDb.tenantMembership.count({ where: { tenantId: ctx.tenantId, role: 'OWNER' } });
      if (owners <= 1) throw new BadRequestException('حداقل یک مدیر کل باید باقی بماند؛ ابتدا نقش را به شخص دیگری منتقل کنید');
    }

    await this.controlDb.tenantMembership.update({ where: { id: target.membershipId }, data: { role } });

    if (transfer && role === 'OWNER' && actorUserId && actorUserId !== id) {
      const self = await this.membershipRoleOf(ctx, actorUserId);
      if (self.membershipId) await this.controlDb.tenantMembership.update({ where: { id: self.membershipId }, data: { role: 'ADMIN' } });
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
