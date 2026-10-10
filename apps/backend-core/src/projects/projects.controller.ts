import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { projectScope } from '../permissions/entity-scopes.js';
import { assertInScope } from '../permissions/scope.util.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ProjectsService } from './projects.service.js';
import { ProjectCollabService } from './project-collab.service.js';
import { ProjectSmsService } from './project-sms.service.js';
import { ManualSmsDto, PreviewSmsTemplateDto, SetProjectSmsNotifyDto } from './dto/project-sms.dto.js';
import { CreateProjectNoteDto, CreateStageLinkDto, LinkDocumentDto, SetPublicLinkDto, SetShowOnPublicDto, SetVisibilityDto } from './dto/project-collab.dto.js';
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
const publicWebUrl = () => (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

@Controller('projects')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly stageTemplates: StageTemplatesService,
    private readonly permissions: PermissionsService,
    private readonly collab: ProjectCollabService,
    private readonly projectSms: ProjectSmsService,
  ) {}

  /**
   * «مشاهده‌ی همه» = همه‌ی پروژه‌ها؛ «فقط خودم» = فقط پروژه‌هایی که کاربر مدیر، سازنده، عضو تیم
   * یا مسئول یکی از مراحلشان است.
   */
  private projectScope(ctx: TenantRequestContext): Promise<Record<string, unknown>> {
    return projectScope(this.permissions, ctx);
  }

  /** دسترسی به یک پروژه‌ی مشخص — برای کاربر «فقط خودم»، فقط پروژه‌های خودش؛ خارج از دامنه = ۴۰۴ (مثل «وجود ندارد»). */
  private async requireAccess(ctx: TenantRequestContext, id: string): Promise<void> {
    await assertInScope(ctx.tenantDb.project, await this.projectScope(ctx), { id }, { message: 'پروژه یافت نشد' });
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

  // ── پیامک وضعیت پروژه — تنظیمات (ویرایش + مشاهده‌ی همه) ─────────────

  private async assertSmsSettingsAccess(ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.permissions.assertViewAll(ctx, 'projects');
  }

  @Get('sms-settings')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.assertSmsSettingsAccess(ctx);
    return this.projectSms.getSettings(ctx);
  }

  @Put('sms-settings')
  async setSmsSettings(@Body() body: Record<string, unknown>, @Ctx() ctx: TenantRequestContext) {
    await this.assertSmsSettingsAccess(ctx);
    return this.projectSms.setSettings(ctx, body);
  }

  @Post('sms-settings/preview')
  async previewSmsTemplate(@Body() dto: PreviewSmsTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.assertSmsSettingsAccess(ctx);
    return this.projectSms.previewTemplate(dto.template, dto.withLink !== false);
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

  // ── پیامک وضعیت پروژه — هر پروژه ────────────────────────────────────

  @Patch(':id/sms-notify')
  async setSmsNotify(@Param('id') id: string, @Body() dto: SetProjectSmsNotifyDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projectSms.setProjectNotify(ctx, id, dto.enabled ?? null);
  }

  @Get(':id/sms-preview')
  async smsPreview(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projectSms.manualPreview(ctx, id);
  }

  @Post(':id/send-sms')
  async sendSms(@Param('id') id: string, @Body() dto: ManualSmsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.projectSms.manualSend(ctx, id, dto.message);
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
    return this.projects.addStage(ctx, id, dto.title, dto.responsibleUserId, dto.requiresManagerApproval ?? true);
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

  // ── لینک عمومی مشتری ────────────────────────────────────────────────

  @Get(':id/public-link')
  async getPublicLink(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.getPublicLink(ctx, id, publicWebUrl());
  }

  @Post(':id/public-link')
  async setPublicLink(@Param('id') id: string, @Body() dto: SetPublicLinkDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.setPublicLink(ctx, id, dto.enabled, publicWebUrl());
  }

  @Post(':id/public-link/regenerate')
  async regeneratePublicLink(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.regeneratePublicLink(ctx, id, publicWebUrl());
  }

  // ── یادداشت‌ها و کامنت مشتری ────────────────────────────────────────

  @Get(':id/notes')
  async listNotes(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.requireAccess(ctx, id);
    return this.collab.listNotes(ctx, id);
  }

  @Post(':id/notes')
  async addNote(@Param('id') id: string, @Body() dto: CreateProjectNoteDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.addNote(ctx, id, dto);
  }

  @Post(':id/notes/:noteId/visibility')
  async setNoteVisibility(@Param('id') id: string, @Param('noteId') noteId: string, @Body() dto: SetVisibilityDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.setNoteVisibility(ctx, id, noteId, dto.visibleToCustomer);
  }

  @Delete(':id/notes/:noteId')
  async removeNote(@Param('id') id: string, @Param('noteId') noteId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.removeNote(ctx, id, noteId);
  }

  // ── لینک و پیوست مرحله (نمایش به مشتری) ──────────────────────────────

  @Post(':id/stages/:stageId/links')
  async addStageLink(@Param('id') id: string, @Param('stageId') stageId: string, @Body() dto: CreateStageLinkDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.addStageLink(ctx, id, stageId, dto);
  }

  @Post(':id/stages/:stageId/links/:linkId/visibility')
  async setStageLinkVisibility(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Param('linkId') linkId: string,
    @Body() dto: SetVisibilityDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.setStageLinkVisibility(ctx, id, stageId, linkId, dto.visibleToCustomer);
  }

  @Delete(':id/stages/:stageId/links/:linkId')
  async removeStageLink(@Param('id') id: string, @Param('stageId') stageId: string, @Param('linkId') linkId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.removeStageLink(ctx, id, stageId, linkId);
  }

  @Post(':id/stages/:stageId/attachments/:attachmentId/visibility')
  async setStageAttachmentVisibility(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: SetVisibilityDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.setStageAttachmentVisibility(ctx, id, stageId, attachmentId, dto.visibleToCustomer);
  }

  // ── اسناد پروژه: پروپوزال و فاکتور ──────────────────────────────────

  @Get(':id/documents')
  async listDocuments(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.requireAccess(ctx, id);
    return this.collab.listDocuments(ctx, id);
  }

  @Post(':id/proposals/:proposalId')
  async linkProposal(@Param('id') id: string, @Param('proposalId') proposalId: string, @Body() dto: LinkDocumentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.linkProposal(ctx, id, proposalId, dto.showOnPublicLink === true);
  }

  @Post(':id/proposals/:proposalId/show')
  async setProposalShow(@Param('id') id: string, @Param('proposalId') proposalId: string, @Body() dto: SetShowOnPublicDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.setProposalShow(ctx, id, proposalId, dto.showOnPublicLink);
  }

  @Delete(':id/proposals/:proposalId')
  async unlinkProposal(@Param('id') id: string, @Param('proposalId') proposalId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.unlinkProposal(ctx, id, proposalId);
  }

  @Post(':id/sales-invoices/:invoiceId')
  async linkInvoice(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @Body() dto: LinkDocumentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.linkInvoice(ctx, id, invoiceId, dto.showOnPublicLink === true);
  }

  @Post(':id/sales-invoices/:invoiceId/show')
  async setInvoiceShow(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @Body() dto: SetShowOnPublicDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.setInvoiceShow(ctx, id, invoiceId, dto.showOnPublicLink);
  }

  @Delete(':id/sales-invoices/:invoiceId')
  async unlinkInvoice(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    await this.requireAccess(ctx, id);
    return this.collab.unlinkInvoice(ctx, id, invoiceId);
  }
}
