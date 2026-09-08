import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { FunnelService } from './funnel.service.js';
import { FunnelKpiService } from './funnel-kpi.service.js';
import { UpdateFunnelStageDto } from './dto/update-funnel-stage.dto.js';

@Controller('crm/funnel')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('crm')
export class FunnelController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly funnel: FunnelService,
    private readonly kpi: FunnelKpiService,
  ) {}

  @Get('summary')
  async summary(@Ctx() ctx: TenantRequestContext) {
    return this.kpi.getFunnelSummary(ctx);
  }

  @Get('kpis')
  async kpis(@Ctx() ctx: TenantRequestContext) {
    return this.kpi.getSalesKpis(ctx);
  }

  /** برای کلیک روی هر مرحله‌ی قیف گرافیکی — لیست مخاطبین آن مرحله. */
  @Get('contacts')
  async contactsInStage(@Query('stage') stage: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    return ctx.tenantDb.crmContact.findMany({
      where: { ...scope, ...(stage ? { funnelStage: stage as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { name: true } } },
    });
  }

  @Post('contacts/:id/stage')
  async updateStage(@Param('id') id: string, @Body() dto: UpdateFunnelStageDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'crm');
    const result = await this.funnel.transitionLeadStage(ctx, id, dto.stage);
    if (!result.ok) throw new BadRequestException(result.error);
    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return contact;
  }
}
