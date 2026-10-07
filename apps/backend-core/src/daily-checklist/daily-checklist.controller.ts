import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { DailyChecklistService } from './daily-checklist.service.js';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto.js';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto.js';
import { CreateChecklistTaskDto } from './dto/create-checklist-task.dto.js';
import { GenerateChecklistReportDto } from './dto/generate-report.dto.js';

/**
 * چک‌لیست کارهای روزانه — یادداشت چسبانِ هر پرسنل، به‌همراه دیدِ مدیر روی
 * چک‌لیست زیردستانش. مجوز مشاهده/ویرایش/حذف طبق ماتریس دسترسی همین ماژول است؛
 * علاوه بر آن، سرویس مانع می‌شود که کسی چک‌لیست غیر از خودش/زیردستش را ببیند.
 */
@Controller('daily-checklist')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('daily-checklist')
export class DailyChecklistController {
  constructor(
    private readonly checklist: DailyChecklistService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('subordinates')
  async subordinates(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'daily-checklist');
    return this.checklist.listSubordinates(ctx);
  }

  @Get()
  async list(@Query('date') date: string, @Query('forUserId') forUserId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'daily-checklist');
    return this.checklist.list(ctx, date, forUserId);
  }

  @Get('report')
  async dayReport(@Query('date') date: string, @Query('forUserId') forUserId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'daily-checklist');
    return this.checklist.getDayReportId(ctx, date, forUserId);
  }

  @Post()
  async create(@Body() dto: CreateChecklistItemDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'daily-checklist');
    return this.checklist.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateChecklistItemDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'daily-checklist');
    return this.checklist.update(ctx, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'daily-checklist');
    return this.checklist.remove(ctx, id);
  }

  @Post(':id/task')
  async createTask(@Param('id') id: string, @Body() dto: CreateChecklistTaskDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'daily-checklist');
    return this.checklist.createTask(ctx, id, dto);
  }

  @Post('generate-report')
  async generateReport(@Body() dto: GenerateChecklistReportDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'daily-checklist');
    return this.checklist.generateReport(ctx, dto);
  }
}
