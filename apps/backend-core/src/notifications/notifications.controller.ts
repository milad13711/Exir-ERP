import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { unreadCount: 0, items: [] };
    const [items, unreadCount] = await Promise.all([
      ctx.tenantDb.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      ctx.tenantDb.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { unreadCount, items };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.notification.updateMany({
      where: { id, userId: userId ?? undefined },
      data: { readAt: new Date() },
    });
  }

  @Post('read-all')
  async markAllRead(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { count: 0 };
    return ctx.tenantDb.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  @Get('preferences')
  async getPreferences(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { emailEnabled: true, smsEnabled: false };
    const pref = await ctx.tenantDb.notificationPreference.findUnique({ where: { userId } });
    return { emailEnabled: pref?.emailEnabled ?? true, smsEnabled: pref?.smsEnabled ?? false };
  }

  @Put('preferences')
  async updatePreferences(@Body() dto: UpdateNotificationPreferenceDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { emailEnabled: true, smsEnabled: false };
    return ctx.tenantDb.notificationPreference.upsert({
      where: { userId },
      create: { userId, emailEnabled: dto.emailEnabled ?? true, smsEnabled: dto.smsEnabled ?? false },
      update: { emailEnabled: dto.emailEnabled, smsEnabled: dto.smsEnabled },
    });
  }
}
