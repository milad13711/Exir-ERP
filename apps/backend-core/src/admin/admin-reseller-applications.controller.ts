import { Body, Controller, Delete, Get, GoneException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { ResellerApplicationsService } from './reseller-applications.service.js';
import { UpdateResellerApplicationDto } from './dto/update-reseller-application.dto.js';
import { RejectResellerApplicationDto } from './dto/reject-reseller-application.dto.js';

const ALL_TEAMS = ['SUPER_ADMIN', 'SUPPORT', 'BILLING', 'ENGINEERING'] as const;

@Controller('admin/reseller-applications')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminResellerApplicationsController {
  constructor(private readonly applications: ResellerApplicationsService) {}

  @Get()
  @AdminTeams(...ALL_TEAMS)
  list(@Query('status') status: string | undefined) {
    return this.applications.list(status);
  }

  @Get(':id')
  @AdminTeams(...ALL_TEAMS)
  get(@Param('id') id: string) {
    return this.applications.get(id);
  }

  @Put(':id')
  @AdminTeams(...ALL_TEAMS)
  update(@Param('id') id: string, @Body() dto: UpdateResellerApplicationDto) {
    return this.applications.update(id, dto);
  }

  @Delete(':id')
  @AdminTeams('SUPER_ADMIN', 'SUPPORT')
  remove(@Param('id') id: string) {
    return this.applications.remove(id);
  }

  @Post(':id/approve')
  @AdminTeams(...ALL_TEAMS)
  approve(@Param('id') _id: string, @AdminCtx() _ctx: AdminRequestContext): never {
    // مسیر قدیمی (ماژول «نمایندگی و رفرال») کنار گذاشته شد؛ تأیید فقط در ماژول نمایندگیِ تننت اصلی (انتخاب محصول و سطح)
    throw new GoneException('تأیید درخواست نمایندگی به ماژول «نمایندگی» در پنل اکسیر (تب درخواست‌ها) منتقل شده است');
  }

  @Post(':id/reject')
  @AdminTeams(...ALL_TEAMS)
  reject(@Param('id') _id: string, @Body() _dto: RejectResellerApplicationDto, @AdminCtx() _ctx: AdminRequestContext): never {
    throw new GoneException('رد درخواست نمایندگی به ماژول «نمایندگی» در پنل اکسیر (تب درخواست‌ها) منتقل شده است');
  }
}
