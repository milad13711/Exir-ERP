import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Ctx } from '../../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { assertTwoFactorForSensitiveAction } from '../../auth/tenant-two-factor-policy.js';
import { OffboardUserDto } from '../dto/offboard-user.dto.js';
import { OffboardingService } from './offboarding.service.js';
import type { OffboardingMode } from './offboarding.engine.js';

/** خروج کاربر / انتقال رکوردها — فقط مالک و مدیر. مسیرهای ثابت (offboarding-runs) قبل از :id می‌آیند. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
export class OffboardingController {
  constructor(private readonly offboarding: OffboardingService) {}

  @Get('users/offboarding-runs/:runId/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="offboarding-report.csv"')
  runCsv(@Param('runId') runId: string, @Ctx() ctx: TenantRequestContext) {
    return this.offboarding.buildRunCsv(ctx, runId);
  }

  @Get('users/:id/offboarding-preview')
  preview(@Param('id') id: string, @Query('mode') mode: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const m: OffboardingMode = mode === 'delete' || mode === 'transfer-only' ? mode : 'deactivate';
    return this.offboarding.preview(ctx, id, m);
  }

  @Post('users/:id/offboarding-dry-run')
  dryRun(@Param('id') id: string, @Body() dto: OffboardUserDto, @Ctx() ctx: TenantRequestContext) {
    return this.offboarding.dryRun(ctx, id, dto);
  }

  @Post('users/:id/offboard')
  offboard(@Param('id') id: string, @Body() dto: OffboardUserDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.offboarding.offboard(ctx, id, dto);
  }
}
