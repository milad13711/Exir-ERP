import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import { invalidateApiKeyCache } from '../api-keys/api-key-verifier.js';
import { ResetTenantUserTwoFactorDto, SetTenantTwoFactorPolicyDto } from './dto/tenant-2fa.dto.js';
import { effectiveMode, graceDays, evaluateTwoFactor } from '../auth/tenant-two-factor-policy.js';

/**
 * ابزارهای پاسخ به حادثه (runbook: docs/security/runbook-incident.md) — فقط SUPER_ADMIN.
 * «ابطال نشست» با افزایش نسخه انجام می‌شود: همه‌ی توکن‌های صادرشده بلافاصله (حداکثر ۵ ثانیه کش) از کار می‌افتند، بدون نیاز به
 * چرخش JWT_SECRET. هر عملیات یک SecurityEvent با نام اجراکننده ثبت می‌کند.
 */
@Controller('admin/security')
@UseGuards(AdminJwtAuthGuard, SuperAdminGuard)
export class AdminSecurityController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly epoch: SessionEpochService,
    private readonly events: SecurityEventsService,
  ) {}

  /** خروج اجباری همه‌ی کاربران و کارشناسان (تننت‌ها و ادمین‌ها) — کاربران با OTP دوباره وارد می‌شوند. */
  @Post('sessions/invalidate-all')
  async invalidateAll(@AdminCtx() ctx: AdminRequestContext) {
    const sessionEpoch = await this.epoch.bump();
    this.events.record({ type: 'SESSIONS_INVALIDATED', severity: 'FATAL', actor: ctx.auth.sub, message: 'GLOBAL session invalidation', context: { sessionEpoch } });
    return { sessionEpoch };
  }

  @Post('tenants/:tenantId/sessions/invalidate')
  async invalidateTenant(@Param('tenantId') tenantId: string, @AdminCtx() ctx: AdminRequestContext) {
    const t = await this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new NotFoundException('تننت یافت نشد');
    const upd = await this.controlDb.tenant.update({ where: { id: tenantId }, data: { tokenVersion: { increment: 1 } }, select: { tokenVersion: true } });
    this.events.record({ type: 'SESSIONS_INVALIDATED', severity: 'ERROR', tenantId, actor: ctx.auth.sub, message: 'tenant session invalidation' });
    return { tokenVersion: upd.tokenVersion };
  }

  @Post('tenants/:tenantId/members/:membershipId/sessions/invalidate')
  async invalidateMember(@Param('tenantId') tenantId: string, @Param('membershipId') membershipId: string, @AdminCtx() ctx: AdminRequestContext) {
    const m = await this.controlDb.tenantMembership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
    if (!m) throw new NotFoundException('عضویت یافت نشد');
    await this.controlDb.tenantMembership.update({ where: { id: membershipId }, data: { tokenVersion: { increment: 1 } } });
    this.events.record({ type: 'SESSIONS_INVALIDATED', severity: 'WARNING', tenantId, actor: ctx.auth.sub, message: 'member session invalidation', context: { membershipId } });
    return { success: true };
  }

  /** ابطال همه‌ی کلیدهای API یک تننت (کلید لو رفته/نفوذ). */
  @Post('tenants/:tenantId/api-keys/revoke-all')
  async revokeAllApiKeys(@Param('tenantId') tenantId: string, @AdminCtx() ctx: AdminRequestContext) {
    const t = await this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new NotFoundException('تننت یافت نشد');
    const res = await this.controlDb.apiKey.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
    invalidateApiKeyCache();
    this.events.record({ type: 'API_KEY_REVOKED_ALL', severity: 'ERROR', tenantId, actor: ctx.auth.sub, message: `revoked ${res.count} API keys`, context: { count: res.count } });
    return { revoked: res.count };
  }

  @Post('admins/:adminId/sessions/invalidate')
  async invalidateAdmin(@Param('adminId') adminId: string, @AdminCtx() ctx: AdminRequestContext) {
    const a = await this.controlDb.adminUser.findUnique({ where: { id: adminId }, select: { id: true } });
    if (!a) throw new NotFoundException('کارشناس یافت نشد');
    await this.controlDb.adminUser.update({ where: { id: adminId }, data: { tokenVersion: { increment: 1 } } });
    this.events.record({ type: 'SESSIONS_INVALIDATED', severity: 'ERROR', actor: ctx.auth.sub, message: 'admin session invalidation', context: { adminId } });
    return { success: true };
  }

  /** مالکان/مدیران یک تننت و وضعیت 2FA آن‌ها (برای دکمه‌ی «بازنشانی 2FA» در پنل ادمین). */
  @Get('tenants/:tenantId/two-factor')
  async twoFactorOverview(@Param('tenantId') tenantId: string) {
    const t = await this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true, twoFactorPolicy: true } });
    if (!t) throw new NotFoundException('تننت یافت نشد');
    const mode = effectiveMode(t.twoFactorPolicy);
    const members = await this.controlDb.tenantMembership.findMany({
      where: { tenantId, role: { in: ['OWNER', 'ADMIN'] }, status: { in: ['ACTIVE', 'INVITED'] } },
      include: { globalUser: { select: { id: true, name: true, phone: true, totpEnabledAt: true } } },
      orderBy: { invitedAt: 'asc' },
    });
    return {
      policy: t.twoFactorPolicy, // null = env
      effectiveMode: mode,
      users: members.map((m) => {
        const st = evaluateTwoFactor({ mode, role: m.role, authType: 'tenant_user', enrolled: !!m.globalUser.totpEnabledAt, graceStartedAt: m.twoFactorGraceStartedAt, graceDays: graceDays() });
        return { userId: m.globalUser.id, membershipId: m.id, name: m.globalUser.name, phone: m.globalUser.phone, role: m.role, enrolled: st.enrolled, graceEndsAt: st.graceEndsAt, restricted: st.restricted };
      }),
    };
  }

  /** جایگزین سیاست 2FA مالک/مدیر برای یک تننت (null = پیروی از env). */
  @Put('tenants/:tenantId/two-factor-policy')
  async setTwoFactorPolicy(@Param('tenantId') tenantId: string, @Body() dto: SetTenantTwoFactorPolicyDto, @AdminCtx() ctx: AdminRequestContext) {
    const t = await this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true, twoFactorPolicy: true } });
    if (!t) throw new NotFoundException('تننت یافت نشد');
    const policy = dto.policy ?? null;
    await this.controlDb.tenant.update({ where: { id: tenantId }, data: { twoFactorPolicy: policy } });
    await this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: ctx.auth.sub, tenantId, action: 'tenant.2fa_policy_changed', entityType: 'Tenant', entityId: tenantId, metadata: { from: t.twoFactorPolicy, to: policy } },
    });
    return { policy };
  }

  /**
   * بازیابی امن وقتی مالک/مدیر هم احراز‌گر و هم کدهای بازیابی را گم کرده است. فقط SUPER_ADMIN، هرگز با پیامک تنها.
   * 2FA کاربر پاک می‌شود، ساعت مهلت عضویت‌های مالک/مدیر او «منقضی» می‌شود (ورود بعدی = نشست محدود تا ثبت مجدد)
   * و همه‌ی نشست‌های فعلی او (tokenVersion همه‌ی عضویت‌ها) باطل می‌شود. با دلیل در AuditLog ثبت می‌شود.
   * پیشنهاد: پیش از اجرا هویت را از مسیر مستقل (تماس تلفنی با شماره‌ی ثبت‌شده/مدارک شرکت) تأیید کنید.
   */
  @Post('tenants/:tenantId/users/:userId/reset-2fa')
  async resetUserTwoFactor(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: ResetTenantUserTwoFactorDto,
    @AdminCtx() ctx: AdminRequestContext,
  ) {
    const m = await this.controlDb.tenantMembership.findFirst({ where: { tenantId, globalUserId: userId }, select: { id: true, role: true } });
    if (!m) throw new NotFoundException('این کاربر عضو این تننت نیست');
    const user = await this.controlDb.globalUser.findUnique({ where: { id: userId }, select: { id: true, totpEnabledAt: true } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    await this.controlDb.globalUser.update({ where: { id: userId }, data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [] } });
    // epoch = مهلت تمام‌شده ⇒ در حالت grace هم بلافاصله ثبت مجدد اجباری می‌شود (در حالت off الزامی نیست).
    await this.controlDb.tenantMembership.updateMany({ where: { globalUserId: userId, role: { in: ['OWNER', 'ADMIN'] } }, data: { twoFactorGraceStartedAt: new Date(0) } });
    const bumped = await this.controlDb.tenantMembership.updateMany({ where: { globalUserId: userId }, data: { tokenVersion: { increment: 1 } } });
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: ctx.auth.sub,
        tenantId,
        action: 'tenant_user.2fa_reset',
        entityType: 'GlobalUser',
        entityId: userId,
        metadata: { reason: dto.reason, membershipId: m.id, role: m.role, wasEnrolled: !!user.totpEnabledAt, sessionsRevoked: bumped.count },
      },
    });
    this.events.record({ type: 'TOTP_RESET', severity: 'ERROR', tenantId, actor: ctx.auth.sub, message: 'platform admin reset tenant user 2FA', context: { userId, membershipId: m.id } });
    return { success: true, sessionsRevoked: bumped.count };
  }

  /** آخرین رویدادهای امنیتی (ورود ناموفق، قفل، rate-limit، ...). */
  @Get('events')
  events_(@Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.controlDb.errorLog.findMany({ where: { service: 'security' }, orderBy: { createdAt: 'desc' }, take });
  }
}
