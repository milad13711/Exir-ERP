import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    // مدیران فعالیت همه را می‌بینند؛ سایر کاربران فقط فعالیت خودشان را
    const manager = ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
    const me = manager ? null : await ctx.tenantDb.user.findFirst({ where: { globalUserId: ctx.auth.sub }, select: { id: true } });
    const logs = await ctx.tenantDb.activityLog.findMany({
      where: manager ? {} : { userId: me?.id ?? '__none__' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { name: true } } },
    });
    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      userName: log.user?.name ?? null,
      createdAt: log.createdAt,
    }));
  }
}
