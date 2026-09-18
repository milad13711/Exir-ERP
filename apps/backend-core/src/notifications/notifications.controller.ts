import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { SubscribePushDto } from './dto/subscribe-push.dto.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly push: PushNotificationsService) {}

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

  @Get('push/vapid-public-key')
  getPushPublicKey() {
    return { publicKey: this.push.getPublicKey(), configured: this.push.isConfigured() };
  }

  @Post('push/subscribe')
  async subscribePush(@Body() dto: SubscribePushDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { success: false };
    await ctx.tenantDb.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth },
      update: { userId, p256dh: dto.p256dh, auth: dto.auth },
    });
    return { success: true };
  }

  @Delete('push/subscribe')
  async unsubscribePush(@Query('endpoint') endpoint: string, @Ctx() ctx: TenantRequestContext) {
    await ctx.tenantDb.pushSubscription.deleteMany({ where: { endpoint } });
    return { success: true };
  }
}
