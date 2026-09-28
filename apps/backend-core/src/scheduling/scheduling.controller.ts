import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { SchedulingService } from './scheduling.service.js';
import { UpdateJobScheduleDto } from './dto/update-job-schedule.dto.js';

/** تنظیمات → زمان‌بندی ارسال خودکار: هر کار پیامکی/اعلانِ زمان‌بندی‌شده + مقدار فعلی تنظیم‌شده برای این تننت. */
@Controller('scheduling')
@UseGuards(JwtAuthGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('jobs')
  async listJobs(@Ctx() ctx: TenantRequestContext) {
    return this.scheduling.listJobs(ctx);
  }

  @Put('jobs/:code')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async updateJob(@Param('code') code: string, @Body() dto: UpdateJobScheduleDto, @Ctx() ctx: TenantRequestContext) {
    return this.scheduling.setConfig(ctx, code, dto);
  }
}
