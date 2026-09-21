import { Body, Controller, Get, NotFoundException, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CompleteFollowupDto } from './dto/complete-followup.dto.js';

/** چک‌این‌های پیگیری ۷/۱۴/۳۰ روزه‌ی هر نمونه — سه ردیف را public-lab-review هنگام ثبت گزارش می‌سازد؛ اینجا فقط تکمیل/مشاهده‌شان است. */
@Controller('ration-lab/followups')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationFollowupsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** پیگیری‌های هنوز تکمیل‌نشده‌ای که سررسیدشان رسیده یا نزدیک است — برای داشبورد کارشناس. */
  @Get('due')
  async listDue(@Query('withinDays') withinDays: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'ration-lab');
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + Number(withinDays ?? 7));
    return ctx.tenantDb.rationFollowUpCheckin.findMany({
      where: { completedAt: null, scheduledAt: { lte: horizon } },
      include: { sample: { select: { id: true, sampleNo: true, contact: { select: { name: true, phone: true } } } } },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  @Patch(':id/complete')
  async complete(@Param('id') id: string, @Body() dto: CompleteFollowupDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    const checkin = await ctx.tenantDb.rationFollowUpCheckin.findUnique({ where: { id } });
    if (!checkin) throw new NotFoundException('پیگیری یافت نشد');
    return ctx.tenantDb.rationFollowUpCheckin.update({
      where: { id },
      data: {
        completedAt: new Date(),
        herdSize: dto.herdSize,
        totalHerdMilkYieldLiters: dto.totalHerdMilkYieldLiters,
        avgMilkYieldPerAnimalLiters: dto.avgMilkYieldPerAnimalLiters,
        milkFatPercent: dto.milkFatPercent,
        milkProteinPercent: dto.milkProteinPercent,
        notes: dto.notes,
      },
    });
  }
}
