import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ModuleReleasesTenantService } from './module-releases-tenant.service.js';
import { ReleasePrefsDto } from './dto/module-release.dto.js';

/** «تازه‌های سیستم» برای کاربران تننت: فقط‌خواندنی (به‌جز دیده‌شدن و تنظیم انصراف مدیر)، فقط ماژول‌های فعال همین تننت. */
@Controller('module-releases')
@UseGuards(JwtAuthGuard)
export class ModuleReleasesController {
  constructor(private readonly svc: ModuleReleasesTenantService) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    return this.svc.list(ctx);
  }

  @Get('unread-count')
  unread(@Ctx() ctx: TenantRequestContext) {
    return this.svc.unreadCount(ctx);
  }

  @Get('settings')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  getSettings(@Ctx() ctx: TenantRequestContext) {
    return this.svc.getPrefs(ctx);
  }

  @Put('settings')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  setSettings(@Body() dto: ReleasePrefsDto, @Ctx() ctx: TenantRequestContext) {
    return this.svc.setPrefs(ctx, dto);
  }

  @Post('read-all')
  readAll(@Ctx() ctx: TenantRequestContext) {
    return this.svc.markAllRead(ctx);
  }

  @Get(':idOrCode')
  detail(@Param('idOrCode') idOrCode: string, @Ctx() ctx: TenantRequestContext) {
    return this.svc.detail(ctx, idOrCode);
  }

  @Post(':id/read')
  read(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.svc.markRead(ctx, id);
  }
}
