import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { StaffAvailabilityService } from './staff-availability.service.js';
import { SaveAvailabilitySlotsDto } from './dto/save-availability-slots.dto.js';

/** هر کاربر لاگین‌شده فقط وقت‌های آزاد خودش را می‌بیند/ویرایش می‌کند — نیازی به مجوز جداگانه نیست. */
@Controller('booking/my-availability')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('booking')
export class StaffAvailabilityController {
  constructor(private readonly availability: StaffAvailabilityService) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    return this.availability.listMine(ctx);
  }

  @Put()
  replace(@Body() dto: SaveAvailabilitySlotsDto, @Ctx() ctx: TenantRequestContext) {
    return this.availability.replaceMine(ctx, dto);
  }
}
