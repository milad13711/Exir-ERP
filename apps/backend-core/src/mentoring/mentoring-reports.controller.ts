import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { MentoringReportsService } from './mentoring-reports.service.js';

@Controller('mentoring/reports')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('mentoring')
export class MentoringReportsController {
  constructor(
    private readonly reports: MentoringReportsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('overview')
  async overview(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'mentoring');
    return this.reports.overview(ctx);
  }

  @Get('client-lifetime')
  async clientLifetime(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'mentoring');
    return this.reports.clientLifetime(ctx);
  }

  @Get('by-advisor')
  async byAdvisor(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'mentoring');
    return this.reports.byAdvisor(ctx);
  }
}
