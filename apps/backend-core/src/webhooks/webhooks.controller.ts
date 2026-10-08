import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { assertPublicHttpUrl, SsrfBlockedError } from '../security/ssrf.js';
import { WEBHOOK_EVENTS } from './webhook-events.js';

@Controller('settings/webhooks')
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule('webhooks')
@Roles('OWNER', 'ADMIN')
export class WebhooksController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('events')
  events() {
    return WEBHOOK_EVENTS;
  }

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    return this.controlDb.webhookSubscription.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateWebhookDto, @Ctx() ctx: TenantRequestContext) {
    try {
      await assertPublicHttpUrl(dto.url); // SSRF: آدرس داخلی/متادیتا/localhost پذیرفته نمی‌شود
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw new BadRequestException(err.message);
      throw err;
    }
    return this.controlDb.webhookSubscription.create({
      data: {
        tenantId: ctx.tenantId,
        url: dto.url,
        events: dto.events,
        secret: randomBytes(24).toString('hex'),
      },
    });
  }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const sub = await this.controlDb.webhookSubscription.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!sub) throw new NotFoundException('وب‌هوک یافت نشد');
    return this.controlDb.webhookSubscription.update({
      where: { id },
      data: { isActive: !sub.isActive },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const sub = await this.controlDb.webhookSubscription.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!sub) throw new NotFoundException('وب‌هوک یافت نشد');
    await this.controlDb.webhookSubscription.delete({ where: { id } });
    return { success: true };
  }

  @Get(':id/deliveries')
  async deliveries(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const sub = await this.controlDb.webhookSubscription.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!sub) throw new NotFoundException('وب‌هوک یافت نشد');
    return this.controlDb.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
