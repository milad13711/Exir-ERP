import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import { invalidateApiKeyCache } from '../api-keys/api-key-verifier.js';

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

  /** آخرین رویدادهای امنیتی (ورود ناموفق، قفل، rate-limit، ...). */
  @Get('events')
  events_(@Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.controlDb.errorLog.findMany({ where: { service: 'security' }, orderBy: { createdAt: 'desc' }, take });
  }
}
