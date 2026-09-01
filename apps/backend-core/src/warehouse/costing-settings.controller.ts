import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { CostingService, type CostingMethod } from './costing.service.js';

class UpdateCostingMethodDto {
  @IsIn(['LAST_COST', 'WEIGHTED_AVERAGE', 'FIFO'])
  method!: CostingMethod;
}

@Controller('warehouse/settings/costing-method')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class CostingSettingsController {
  constructor(private readonly costing: CostingService) {}

  @Get()
  async get(@Ctx() ctx: TenantRequestContext) {
    return { method: await this.costing.getMethod(ctx) };
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async update(@Body() dto: UpdateCostingMethodDto, @Ctx() ctx: TenantRequestContext) {
    await this.costing.setMethod(ctx, dto.method);
    return { method: dto.method };
  }
}
