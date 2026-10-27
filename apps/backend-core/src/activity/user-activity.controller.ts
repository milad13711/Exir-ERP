import { Body, Controller, ForbiddenException, Get, Header, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { resolveArchiveAccess } from './user-activity-access.js';
import { UserActivityService } from './user-activity.service.js';
import { parseTimelineFilters } from './user-activity.logic.js';

/**
 * آرشیو فعالیت کاربر (تب «سوابق فعالیت» در پروفایل). دسترسی: خود کاربر، مالک/مدیر، مدیر HR/سلسله‌مراتبی (user-activity-access.ts).
 * مسیرهای ثابت (activity/retention) قبل از :id تعریف شده‌اند.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class UserActivityController {
  constructor(
    private readonly svc: UserActivityService,
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  /** «me» = خودِ کاربر جاری (برای تب سوابق در پروفایل من). */
  private async access(ctx: TenantRequestContext, rawId: string) {
    const id = rawId === 'me' ? ((await resolveTenantUserId(ctx).catch(() => null)) ?? rawId) : rawId;
    const access = await resolveArchiveAccess(ctx, id, { permissions: this.permissions, controlDb: this.controlDb });
    return { id, access };
  }

  private assertManager(ctx: TenantRequestContext) {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک و مدیر');
  }

  @Get('activity/retention')
  retention(@Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.svc.getRetention(ctx);
  }

  @Put('activity/retention')
  setRetention(@Body() body: { retentionDays?: number | null }, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.svc.setRetention(ctx, body?.retentionDays ?? null);
  }

  @Get('users/:id/activity')
  async list(@Param('id') id: string, @Query() q: Record<string, string | undefined>, @Ctx() ctx: TenantRequestContext) {
    const { id: uid, access } = await this.access(ctx, id);
    const res = await this.svc.list(ctx, access, uid, parseTimelineFilters(q), { cursor: q.cursor, limit: q.limit ? Number(q.limit) : undefined });
    return { ...res, level: access.level };
  }

  @Get('users/:id/activity/summary')
  async summary(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const { id: uid, access } = await this.access(ctx, id);
    return this.svc.summary(ctx, access, uid);
  }

  @Get('users/:id/activity/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Param('id') id: string, @Query() q: Record<string, string | undefined>, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const { id: uid, access } = await this.access(ctx, id);
    const csv = await this.svc.exportCsv(ctx, access, uid, parseTimelineFilters(q));
    res.setHeader('Content-Disposition', 'attachment; filename="user-activity.csv"');
    res.send(csv);
  }
}
