import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ProjectsService } from './projects.service.js';
import { StageTemplatesService } from './stage-templates.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { SaveStageTemplateDto } from './dto/save-stage-template.dto.js';
import { AddStageDto } from './dto/add-stage.dto.js';
import { RejectStageDto } from './dto/reject-stage.dto.js';
import { AssignStageDto } from './dto/assign-stage.dto.js';
import { CompleteStageDto } from './dto/complete-stage.dto.js';
import { UpdateStageDto } from './dto/update-stage.dto.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

/**
 * The `stage-templates/*` routes are static path segments living under the
 * same `/projects` prefix as `:id`-parameterized routes below — they MUST
 * stay declared before any `:id` route in this class, or Express's
 * registration-order route matching would treat "stage-templates" as an
 * `:id` value and never reach them (see employees.controller.ts's
 * export/org-chart-before-:id for the same established pattern).
 */
@Controller('projects')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly stageTemplates: StageTemplatesService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * «مشاهده‌ی همه» = همه‌ی پروژه‌ها؛ «فقط خودم» = فقط پروژه‌هایی که کاربر مدیر، سازنده، عضو تیم
   * یا مسئول یکی از مراحلشان است.
   */
  private async projectScope(ctx: TenantRequestContext): Promise<Record<string, unknown>> {
    const matrix = await this.permissions.getEffective(ctx, 'projects');
    if (matrix.canViewAll) return {};
    if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    const userId = await resolveTenantUserId(ctx);
    return {
      OR: [
        { managerUserId: userId },
        { createdByUserId: userId },
        { members: { some: { userId } } },
        { stages: { some: { responsibleUserId: userId } } },
      ],
    };
  }

  /** دسترسی به یک پروژه‌ی مشخص — برای کاربر «فقط خودم»، فقط پروژه‌های خودش. */
  private async requireAccess(ctx: TenantRequestContext, id: string): Promise<void> {
    const scope = await this.projectScope(ctx);
    if (Object.keys(scope).length === 0) return;
    const found = await ctx.tenantDb.project.findFirst({ where: { id, ...scope }, select: { id: true } });
    if (!found) throw new ForbiddenException('به این پروژه دسترسی ندارید');
  }

  @Get('stage-templates')
  async listStageTemplates(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'projects');
    return this.stageTemplates.list(ctx);
  }

  @Post('stage-templates')
  async createStageTemplate(@Body() dto: SaveStageTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'projects');
    return this.stageTemplates.create(ctx, dto);
  }

  @Patch('stage-templates/:templateId')
  async updateStageTemplate(
    @Param('templateId') templateId: string,
    @Body() dto: SaveStageTemplateDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    return this.stageTemplates.update(ctx, templateId, dto);
  }

  @Delete('stage-templates/:templateId')
  async removeStageTemplate(@Param('templateId') templateId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'projects');
    return this.stageTemplates.remove(ctx, templateId);
  }

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('q') q: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.projects.list(ctx, { status, contactId, q }, await this.projectScope(ctx));
  }

  @Post()
  async create(@Body() dto: CreateProjectDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'projects');
    return this.projects.create(ctx, dto);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.projects.detail(ctx, id, await this.projectScope(ctx));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.update(ctx, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.remove(ctx, id);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.start(ctx, id);
  }

  @Post(':id/hold')
  async hold(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.hold(ctx, id);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.complete(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.cancel(ctx, id);
  }

  @Get(':id/invoices')
  async listInvoices(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.requireAccess(ctx, id);
    return this.projects.listInvoices(ctx, id);
  }

  @Post(':id/stages')
  async addStage(@Param('id') id: string, @Body() dto: AddStageDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.addStage(ctx, id, dto.title, dto.responsibleUserId);
  }

  @Patch(':id/stages/:stageId')
  async updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: UpdateStageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.updateStage(ctx, id, stageId, dto);
  }

  @Delete(':id/stages/:stageId')
  async removeStage(@Param('id') id: string, @Param('stageId') stageId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.removeStage(ctx, id, stageId);
  }

  @Post(':id/stages/:stageId/assign')
  async assignStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: AssignStageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.assignStage(ctx, id, stageId, dto.responsibleUserId);
  }

  @Post(':id/stages/:stageId/request-start')
  async requestStageStart(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.requestStageStart(ctx, id, stageId);
  }

  /** تأیید/رد اجرای مرحله — عملی سطح مدیریتی، به همان سطح دسترسی «حذف» روی ماژول پروژه نیاز دارد. */
  @Post(':id/stages/:stageId/approve')
  async approveStage(@Param('id') id: string, @Param('stageId') stageId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.approveStage(ctx, id, stageId);
  }

  @Post(':id/stages/:stageId/reject')
  async rejectStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: RejectStageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertDelete(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.rejectStage(ctx, id, stageId, dto.reason);
  }

  @Post(':id/stages/:stageId/complete')
  async completeStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: CompleteStageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projects.completeStage(ctx, id, stageId, dto.report);
  }
}
