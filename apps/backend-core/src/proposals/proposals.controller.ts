import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { proposalScope } from '../permissions/entity-scopes.js';
import { ProposalsService } from './proposals.service.js';
import { ProposalTemplatesService } from './proposal-templates.service.js';
import { CreateProposalDto } from './dto/create-proposal.dto.js';
import { UpdateProposalDto } from './dto/update-proposal.dto.js';
import {
  AssignProposalDto,
  CreateProposalTemplateDto,
  IssueProposalInvoiceDto,
  SetProposalStatusDto,
  StaffCommentDto,
  UpdateProposalTemplateDto,
  UpdateStatusNoteDto,
} from './dto/proposal-actions.dto.js';

const publicWebUrl = () => (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

/**
 * دسترسی: هر مسیر با `proposalScope` (سازنده یا ارجاع‌شده برای «فقط خودم») از ماتریس ماژول `proposals`
 * عبور می‌کند و سرویس هر مسیر by-id را دوباره با همان scope می‌خواند (خارج از دامنه → ۴۰۴).
 * انتخاب مشتری/معامله هم با دامنه‌ی ماژول CRM کاربر چک می‌شود تا کسی مشتری دیگران را به پروپوزال خود وصل نکند.
 */
@Controller('proposals')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('proposals')
export class ProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly templates: ProposalTemplatesService,
    private readonly permissions: PermissionsService,
  ) {}

  private scope(ctx: TenantRequestContext) {
    return proposalScope(this.permissions, ctx);
  }

  private contactScope(ctx: TenantRequestContext) {
    return this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
  }

  // ── قالب‌ها (پیش از مسیرهای :id تا با آن‌ها اشتباه نشوند) ──

  @Get('templates')
  async listTemplates(@Ctx() ctx: TenantRequestContext) {
    await this.scope(ctx); // همان بررسی دسترسی مشاهده‌ی ماژول
    return this.templates.list(ctx);
  }

  @Get('templates/:id')
  async templateDetail(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.scope(ctx);
    return this.templates.detail(ctx, id);
  }

  @Post('templates')
  async createTemplate(@Body() dto: CreateProposalTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'proposals');
    return this.templates.create(ctx, dto, await this.scope(ctx));
  }

  @Patch('templates/:id')
  async updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProposalTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.templates.update(ctx, id, dto);
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'proposals');
    return this.templates.remove(ctx, id);
  }

  // ── پروپوزال‌ها ──

  @Get()
  async list(
    @Query('q') q: string | undefined,
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('assignedUserId') assignedUserId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.proposals.list(ctx, await this.scope(ctx), { q, status, contactId, assignedUserId });
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    return this.proposals.detail(ctx, id, await this.scope(ctx));
  }

  @Post()
  async create(@Body() dto: CreateProposalDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'proposals');
    return this.proposals.create(ctx, dto, await this.contactScope(ctx));
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProposalDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.update(ctx, id, dto, await this.scope(ctx), await this.contactScope(ctx));
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'proposals');
    return this.proposals.remove(ctx, id, await this.scope(ctx));
  }

  @Post(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetProposalStatusDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.setStatus(ctx, id, dto.status, dto.note, await this.scope(ctx));
  }

  @Patch(':id/status-note')
  async statusNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusNoteDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.updateStatusNote(ctx, id, dto.statusNote, await this.scope(ctx));
  }

  @Post(':id/assign')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignProposalDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.assign(ctx, id, dto, await this.scope(ctx));
  }

  @Post(':id/comments')
  async comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffCommentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.addStaffComment(ctx, id, dto.body, await this.scope(ctx));
  }

  @Post(':id/link')
  async link(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.shareLink(ctx, id, await this.scope(ctx), publicWebUrl());
  }

  @Get(':id/sms-preview')
  async smsPreview(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.smsPreview(ctx, id, await this.scope(ctx), publicWebUrl());
  }

  @Post(':id/send-sms')
  async sendSms(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    return this.proposals.sendSms(ctx, id, await this.scope(ctx), publicWebUrl());
  }

  @Post(':id/issue-invoice')
  async issueInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueProposalInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'proposals');
    await this.permissions.assertCreate(ctx, 'sales'); // ساخت فاکتور = مجوز ساخت در ماژول فروش
    return this.proposals.issueInvoice(ctx, id, dto, await this.scope(ctx));
  }
}
