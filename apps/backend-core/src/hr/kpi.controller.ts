import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { KpiService } from './kpi.service.js';

@Controller('hr/employees/:id/kpi')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class KpiController {
  constructor(
    private readonly kpi: KpiService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async get(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'hr');
    return this.kpi.compute(ctx, id, from, to);
  }
}
