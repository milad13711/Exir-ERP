import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { AdminUsersService } from './admin-users.service.js';
import { CreateAdminUserDto, SetAdminTeamDto } from './dto/admin-account.dto.js';

/** کاربران پلتفرم — فقط SUPER_ADMIN. */
@Controller('admin/users')
@UseGuards(AdminJwtAuthGuard, SuperAdminGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  /** رمز یک‌بارمصرف فقط در همین پاسخ برمی‌گردد. */
  @Post()
  create(@Body() dto: CreateAdminUserDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.users.create(ctx.auth.sub, dto);
  }

  @Post(':id/reset-password')
  reset(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.users.resetPassword(ctx.auth.sub, id);
  }

  @Post(':id/disable')
  disable(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.users.setActive(ctx.auth.sub, id, false);
  }

  @Post(':id/enable')
  enable(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext) {
    return this.users.setActive(ctx.auth.sub, id, true);
  }

  @Patch(':id/team')
  team(@Param('id') id: string, @Body() dto: SetAdminTeamDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.users.setTeam(ctx.auth.sub, id, dto.team);
  }
}
