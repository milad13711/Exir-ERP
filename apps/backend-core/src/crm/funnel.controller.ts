import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { assertInScope } from '../permissions/scope.util.js';
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
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    return this.kpi.getFunnelSummary(ctx, scope);
  }

  @Get('kpis')
  async kpis(@Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    return this.kpi.getSalesKpis(ctx, scope);
  }

  /** عنوان فعلی هر مرحله‌ی اصلی قیف — برای تنظیمات شخصی‌سازی نام مراحل. */
  @Get('stage-labels')
  async stageLabels(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'crm');
    return this.kpi.getStageLabels(ctx);
  }

  @Patch('stage-labels')
  async updateStageLabels(@Body() body: { labels: Record<string, string> }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'crm');
    return this.kpi.setStageLabels(ctx, body.labels ?? {});
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
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    await assertInScope(ctx.tenantDb.crmContact, scope, { id }, { message: 'مخاطب یافت نشد' });
    const result = await this.funnel.transitionLeadStage(ctx, id, dto.stage);
    if (!result.ok) throw new BadRequestException(result.error);
    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return contact;
  }
}
