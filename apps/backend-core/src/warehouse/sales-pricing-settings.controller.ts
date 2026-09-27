import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { CostingService } from './costing.service.js';

class UpdateAutoSalePriceDto {
  @IsBoolean()
  enabled!: boolean;
}

/**
 * تنظیمات فروش → «محاسبه خودکار قیمت فروش از درصد سود». همان الگوی دقیق
 * CostingSettingsController (روش بهای تمام‌شده) — یک کلید بولی روی
 * ModuleSetting('warehouse', 'autoSalePriceFromMargin').
 */
@Controller('warehouse/settings/auto-sale-price')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class SalesPricingSettingsController {
  constructor(private readonly costing: CostingService) {}

  @Get()
  async get(@Ctx() ctx: TenantRequestContext) {
    return { enabled: await this.costing.getAutoSalePriceEnabled(ctx) };
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async update(@Body() dto: UpdateAutoSalePriceDto, @Ctx() ctx: TenantRequestContext) {
    await this.costing.setAutoSalePriceEnabled(ctx, dto.enabled);
    return { enabled: dto.enabled };
  }
}
