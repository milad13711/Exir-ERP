import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TriggerRegistryService } from './trigger-registry.service.js';
import { AutomationEngineService } from './automation-engine.service.js';
import { CreateRuleDto } from './dto/create-rule.dto.js';
import { UpdateRuleDto } from './dto/update-rule.dto.js';
import { FireTriggerDto } from './dto/fire-trigger.dto.js';

const RULE_INCLUDE = {
  actions: { orderBy: { sequenceOrder: 'asc' as const } },
  createdBy: { select: { id: true, name: true } },
  runLogs: { orderBy: { ranAt: 'desc' as const }, take: 5 },
};

@Controller('automation')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('automation')
export class AutomationController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
    private readonly registry: TriggerRegistryService,
    private readonly engine: AutomationEngineService,
  ) {}

  /** Trigger catalog, filtered to modules this tenant actually has installed — a trigger from an uninstalled module would be a dead end in the rule builder. */
  @Get('triggers')
  async listTriggers(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'automation');
    const installed = await this.controlDb.tenantModule.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ['INSTALLED', 'TRIAL'] } },
      include: { module: { select: { code: true } } },
    });
    const installedCodes = new Set(installed.map((m) => m.module.code));
    return this.registry
      .getAll()
      .filter((t) => installedCodes.has(t.moduleCode))
      .map((t) => ({
        code: t.code,
        moduleCode: t.moduleCode,
        label: t.label,
        description: t.description ?? null,
        payloadFields: t.payloadFields,
        supportsManualTrigger: Boolean(t.resolvePayload),
      }));
  }

  @Get('rules')
  async listRules(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'automation');
    return ctx.tenantDb.automationRule.findMany({ include: RULE_INCLUDE, orderBy: { createdAt: 'desc' } });
  }

  @Get('rules/:id')
  async getRule(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'automation');
    const rule = await ctx.tenantDb.automationRule.findUnique({
      where: { id },
      include: { ...RULE_INCLUDE, runLogs: { orderBy: { ranAt: 'desc' as const }, take: 20 } },
    });
    if (!rule) throw new NotFoundException('قانون اتوماسیون یافت نشد');
    return rule;
  }

  @Post('rules')
  async createRule(@Body() dto: CreateRuleDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'automation');
    if (!this.registry.get(dto.triggerCode)) throw new NotFoundException('تریگر انتخاب‌شده یافت نشد');

    const userId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.automationRule.create({
      data: {
        name: dto.name,
        triggerCode: dto.triggerCode,
        createdByUserId: userId,
        actions: {
          create: dto.actions.map((a, i) => ({
            type: a.type,
            config: a.config as never,
            sequenceOrder: a.sequenceOrder ?? i,
          })),
        },
      },
      include: RULE_INCLUDE,
    });
  }

  @Patch('rules/:id')
  async updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'automation');
    await this.permissions.assertViewAll(ctx, 'automation'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    const existing = await ctx.tenantDb.automationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قانون اتوماسیون یافت نشد');
    if (dto.triggerCode && !this.registry.get(dto.triggerCode)) throw new NotFoundException('تریگر انتخاب‌شده یافت نشد');
    const actions = dto.actions;
    // تغییر تریگر یا اقدام‌ها اتمی است: اقدام‌های قبلی و جدید هیچ‌وقت نیمه‌کاره باقی نمی‌مانند.
    const update = ctx.tenantDb.automationRule.update({
      where: { id },
      data: {
        name: dto.name,
        isActive: dto.isActive,
        triggerCode: dto.triggerCode,
        ...(actions
          ? { actions: { create: actions.map((a, i) => ({ type: a.type, config: a.config as never, sequenceOrder: a.sequenceOrder ?? i })) } }
          : {}),
      },
      include: RULE_INCLUDE,
    });
    if (!actions) return update;
    const [, updated] = await ctx.tenantDb.$transaction([ctx.tenantDb.automationAction.deleteMany({ where: { ruleId: id } }), update]);
    return updated;
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'automation');
    await this.permissions.assertViewAll(ctx, 'automation'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    const existing = await ctx.tenantDb.automationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قانون اتوماسیون یافت نشد');
    await ctx.tenantDb.automationRule.delete({ where: { id } });
    return { success: true };
  }

  /** Manually re-fires a trigger for one specific record — only works for triggers that registered a `resolvePayload`. */
  @Post('fire')
  async fire(@Body() dto: FireTriggerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'automation');
    const definition = this.registry.get(dto.triggerCode);
    if (!definition) throw new NotFoundException('تریگر یافت نشد');
    if (!definition.resolvePayload) throw new ForbiddenException('این تریگر از اجرای دستی پشتیبانی نمی‌کند');

    const payload = await definition.resolvePayload(ctx, dto.entityId);
    await this.engine.emit(ctx, dto.triggerCode, payload);
    return { success: true };
  }
}
