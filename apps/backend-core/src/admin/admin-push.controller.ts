import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PushNotificationsService } from '../notifications/push-notifications.service.js';
import { SubscribePushDto } from './dto/subscribe-push.dto.js';

@Controller('admin/push')
@UseGuards(AdminJwtAuthGuard)
export class AdminPushController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly push: PushNotificationsService,
  ) {}

  @Get('vapid-public-key')
  getPublicKey() {
    return { publicKey: this.push.getPublicKey(), configured: this.push.isConfigured() };
  }

  @Post('subscribe')
  async subscribe(@Body() dto: SubscribePushDto, @AdminCtx() ctx: AdminRequestContext) {
    await this.controlDb.adminPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { adminUserId: ctx.auth.sub, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth },
      update: { adminUserId: ctx.auth.sub, p256dh: dto.p256dh, auth: dto.auth },
    });
    return { success: true };
  }

  @Delete('subscribe')
  async unsubscribe(@Query('endpoint') endpoint: string) {
    await this.controlDb.adminPushSubscription.deleteMany({ where: { endpoint } });
    return { success: true };
  }
}
