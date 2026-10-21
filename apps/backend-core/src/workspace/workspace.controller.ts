import { BadRequestException, Body, Controller, Get, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import { UpdateBrandingDto } from './dto/update-branding.dto.js';
import { SwitchTenantDto } from './dto/switch-tenant.dto.js';
import { checkDataUri } from '../common/validators/upload-limits.js';
import { normalizeDisplayName } from './profile-name.js';
import { ProfileSyncService } from './profile-sync.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateNavOrderDto } from './dto/update-nav-order.dto.js';
import { UpdateStampDelegateDto } from './dto/update-stamp-delegate.dto.js';

/** Bootstrap endpoint the frontend calls once after login to fill the header/shell. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly auth: AuthService,
    private readonly stamp: CompanyStampService,
    private readonly permissions: PermissionsService,
    private readonly profileSync: ProfileSyncService,
  ) {}

  @Get()
  async me(@Ctx() ctx: TenantRequestContext) {
    const [globalUser, tenant, tenantUser] = await Promise.all([
      this.controlDb.globalUser.findUniqueOrThrow({ where: { id: ctx.auth.sub } }),
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      ctx.tenantDb.user.findUnique({
        where: { globalUserId: ctx.auth.sub },
        include: { roles: { include: { role: true } } },
      }),
    ]);

    return {
      user: {
        name: globalUser.name,
        phone: globalUser.phone,
        email: tenantUser?.email ?? null,
        avatarUrl: globalUser.avatarUrl,
        roleTitle: tenantUser?.roles[0]?.role.name ?? null,
        membershipRole: ctx.auth.role,
      },
      tenant: { name: tenant.name, slug: tenant.slug, publicKey: tenant.publicKey, themeColor: tenant.themeColor },
      navOrder: tenantUser?.navOrder ?? [],
      twoFactor: await this.twoFactorFor(ctx, globalUser, tenant),
      permissions: await this.permissions.effectiveMatrix(ctx),
    };
  }

  /** وضعیت 2FA اجباری مالک/مدیر برای بنر/صفحه‌ی ثبت: {required, enrolled, graceEndsAt, mode, restricted}. */
  private async twoFactorFor(ctx: TenantRequestContext, globalUser: { totpEnabledAt: Date | null }, tenant: { twoFactorPolicy: string | null }) {
    if (ctx.auth.type !== 'tenant_user') return { required: false, enrolled: false, graceEndsAt: null, mode: 'off', restricted: false };
    const membership = await this.controlDb.tenantMembership.findUniqueOrThrow({ where: { id: ctx.auth.membershipId } });
    return this.auth.twoFactorState(tenant, membership, globalUser);
  }

  /** ترتیب دستی آیتم‌های منوی کناری — خالی یعنی چیدمان پیش‌فرض دسته‌بندی‌شده استفاده شود. */
  @Patch('nav-order')
  async updateNavOrder(@Body() dto: UpdateNavOrderDto, @Ctx() ctx: TenantRequestContext) {
    await ctx.tenantDb.user.updateMany({ where: { globalUserId: ctx.auth.sub }, data: { navOrder: dto.order } });
    return { navOrder: dto.order };
  }

  /** تکمیل پروفایل شخصی — نام و تصویر در سطح شخص (مشترک بین همه‌ی محیط‌های کاری او)، ایمیل مخصوص همین محیط کاری. */
  @Patch('profile')
  async updateProfile(@Body() dto: UpdateProfileDto, @Ctx() ctx: TenantRequestContext) {
    const current = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: ctx.auth.sub }, select: { name: true, avatarUrl: true } });
    const data: { name?: string; avatarUrl?: string | null } = {};
    let nameChanged = false;
    if (dto.name !== undefined) {
      const name = normalizeDisplayName(dto.name);
      if (name !== (current.name ?? '')) {
        data.name = name;
        nameChanged = true;
      }
    }
    // تصویر فقط وقتی واقعاً عوض شده اعتبارسنجی می‌شود (تصویر قدیمیِ بزرگ/لینکی جلوی تغییر نام را نگیرد)
    if (dto.avatarUrl !== undefined && dto.avatarUrl !== current.avatarUrl) {
      if (dto.avatarUrl !== null && dto.avatarUrl !== '') {
        const bad = dto.avatarUrl.startsWith('data:') ? checkDataUri(dto.avatarUrl, 'smallImage') : 'فرمت تصویر نامعتبر است';
        if (bad) throw new BadRequestException(`تصویر پروفایل: ${bad}`);
      }
      data.avatarUrl = dto.avatarUrl || null;
    }
    const globalUser = Object.keys(data).length
      ? await this.controlDb.globalUser.update({ where: { id: ctx.auth.sub }, data })
      : await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: ctx.auth.sub } });
    if (dto.email !== undefined) {
      await ctx.tenantDb.user.updateMany({ where: { globalUserId: ctx.auth.sub }, data: { email: dto.email } });
    }
    if (nameChanged && data.name) {
      const sync = await this.profileSync.syncName(ctx.auth.sub, data.name);
      const me = await ctx.tenantDb.user.findUnique({ where: { globalUserId: ctx.auth.sub }, select: { id: true } });
      await ctx.tenantDb.activityLog
        .create({
          data: {
            userId: me?.id ?? null, action: 'profile.name_changed', entityType: 'User', entityId: me?.id ?? null, actorType: 'MANUAL', moduleCode: 'users', actionType: 'update',
            summary: 'تغییر نام نمایشی توسط خود کاربر', metadata: { from: current.name ?? null, to: data.name, tenantsSynced: sync.tenants, tenantsFailed: sync.failed },
          },
        })
        .catch(() => undefined);
    }
    const tenantUser = await ctx.tenantDb.user.findUnique({ where: { globalUserId: ctx.auth.sub } });
    return { name: globalUser.name, email: tenantUser?.email ?? null, avatarUrl: globalUser.avatarUrl };
  }

  /** فهرست محیط‌های کاری دیگری که همین کاربر عضو فعال آن‌هاست — برای سوییچر داخل هدر. */
  @Get('tenants')
  async myTenants(@Ctx() ctx: TenantRequestContext) {
    return this.auth.listMyTenants(ctx.auth.sub);
  }

  @Post('switch-tenant')
  async switchTenant(@Body() dto: SwitchTenantDto, @Ctx() ctx: TenantRequestContext) {
    return this.auth.switchTenant(ctx.auth.sub, dto.tenantSlug);
  }

  /** ماژول‌های این تننت که تا ۱۰ روز دیگر منقضی می‌شوند — برای هشدار داخل هدر. */
  @Get('module-renewals')
  async moduleRenewals(@Ctx() ctx: TenantRequestContext) {
    const noticeThreshold = new Date(Date.now() + 10 * 86_400_000);
    const dueModules = await this.controlDb.tenantModule.findMany({
      where: {
        tenantId: ctx.tenantId,
        billingMode: { in: ['MONTHLY', 'YEARLY'] },
        currentPeriodEnd: { lte: noticeThreshold },
      },
      include: { module: true },
    });
    return dueModules.map((tm) => ({
      code: tm.module.code,
      name: tm.module.name,
      currentPeriodEnd: tm.currentPeriodEnd,
      daysLeft: tm.currentPeriodEnd ? Math.ceil((tm.currentPeriodEnd.getTime() - Date.now()) / 86_400_000) : null,
      invoiceId: tm.pendingRenewalInvoiceId,
    }));
  }

  @Patch('branding')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async updateBranding(@Body() dto: UpdateBrandingDto, @Ctx() ctx: TenantRequestContext) {
    const tenant = await this.controlDb.tenant.update({
      where: { id: ctx.tenantId },
      data: { themeColor: dto.themeColor },
    });
    return { themeColor: tenant.themeColor };
  }

  /** فقط مالک — کاربری که به‌جای او مجاز است اسناد رسمی را با مهر/امضای شرکت امضا کند، به‌همراه فهرست کاربران تننت برای انتخاب. */
  @Get('stamp-delegate')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async getStampDelegate(@Ctx() ctx: TenantRequestContext) {
    const [delegateUserId, users] = await Promise.all([
      this.stamp.getDelegateUserId(ctx),
      ctx.tenantDb.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { delegateUserId, users };
  }

  @Put('stamp-delegate')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async setStampDelegate(@Body() dto: UpdateStampDelegateDto, @Ctx() ctx: TenantRequestContext) {
    return this.stamp.setDelegateUserId(ctx, dto.userId ?? null);
  }
}
