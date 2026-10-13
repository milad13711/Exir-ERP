import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { TimeBlocksService } from './time-blocks.service.js';
import { CreateTimeBlockDto, UpdateBookingPreferencesDto, UpdateTimeBlockDto } from './dto/time-block.dto.js';

/**
 * ساعت‌های غیرفعال رزرو. بدون userId = خود کاربر (مثل my-availability، نیاز به مجوز جدا ندارد)؛
 * با userId دیگران فقط برای مدیر (مشاهده‌ی همه + ویرایش در booking) — بررسی در TimeBlocksService.
 */
@Controller('booking/time-blocks')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('booking')
export class TimeBlocksController {
  constructor(private readonly timeBlocks: TimeBlocksService) {}

  @Get()
  overview(@Query('userId') userId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.timeBlocks.overview(ctx, userId);
  }

  @Get('auto-preview')
  autoPreview(@Query('userId') userId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.timeBlocks.autoPreview(ctx, userId);
  }

  @Put('preferences')
  updatePreferences(@Body() dto: UpdateBookingPreferencesDto, @Ctx() ctx: TenantRequestContext) {
    return this.timeBlocks.updatePreferences(ctx, dto);
  }

  @Post()
  create(@Body() dto: CreateTimeBlockDto, @Ctx() ctx: TenantRequestContext) {
    return this.timeBlocks.create(ctx, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTimeBlockDto, @Ctx() ctx: TenantRequestContext) {
    return this.timeBlocks.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.timeBlocks.remove(ctx, id);
  }
}
