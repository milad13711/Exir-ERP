import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { FormsService } from './forms.service.js';
import { FormsInboxService } from './forms-inbox.service.js';
import { formScope } from './form-scope.js';
import { UpdateSubmissionDto } from './dto/update-submission.dto.js';
import { CreateFormDto } from './dto/create-form.dto.js';
import { UpdateFormDto } from './dto/update-form.dto.js';

@Controller('forms')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('forms')
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly inbox: FormsInboxService,
    private readonly permissions: PermissionsService,
  ) {}

  private scope(ctx: TenantRequestContext) {
    return formScope(this.permissions, ctx);
  }

  @Get()
  async list(@Query('status') status: string | undefined, @Query('type') type: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.forms.list(ctx, { status, type }, await this.scope(ctx));
  }

  /** ویجت داشبورد «درخواست‌های جدید فرم‌ها» — باید قبل از `:id` بیاید تا با آن اشتباه گرفته نشود. */
  @Get('inbox-summary')
  async inboxSummary(@Ctx() ctx: TenantRequestContext) {
    return this.inbox.inboxSummary(ctx, await this.scope(ctx));
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.forms.detail(ctx, id, await this.scope(ctx));
  }

  @Post()
  async create(@Body() dto: CreateFormDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'forms');
    return this.forms.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateFormDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    await this.permissions.assertViewAll(ctx, 'forms'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.forms.update(ctx, id, dto);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    await this.permissions.assertViewAll(ctx, 'forms'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.forms.setStatus(ctx, id, 'PUBLISHED');
  }

  @Post(':id/close')
  async close(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    await this.permissions.assertViewAll(ctx, 'forms'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.forms.setStatus(ctx, id, 'CLOSED');
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    await this.permissions.assertViewAll(ctx, 'forms'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.forms.setStatus(ctx, id, 'DRAFT');
  }

  @Post(':id/delete')
  async delete(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'forms');
    await this.permissions.assertViewAll(ctx, 'forms'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.forms.delete(ctx, id);
  }

  @Get(':id/submissions')
  async listSubmissions(@Param('id') id: string, @Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.inbox.listSubmissions(ctx, id, await this.scope(ctx), status);
  }

  @Get(':id/stats')
  async stats(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.forms.stats(ctx, id, await this.scope(ctx));
  }

  @Get('submissions/by-contact/:contactId')
  async listSubmissionsByContact(@Param('contactId') contactId: string, @Ctx() ctx: TenantRequestContext) {
    return this.forms.listSubmissionsByContact(ctx, contactId, await this.scope(ctx));
  }

  @Get('submissions/:submissionId')
  async submissionDetail(@Param('submissionId') submissionId: string, @Ctx() ctx: TenantRequestContext) {
    return this.inbox.submissionDetail(ctx, submissionId, await this.scope(ctx));
  }

  /** باز کردن پاسخ = «دیده شد» (NEW → IN_REVIEW). فقط دسترسی مشاهده لازم است. */
  @Post('submissions/:submissionId/viewed')
  async markViewed(@Param('submissionId') submissionId: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.scope(ctx);
    return this.inbox.markViewed(ctx, submissionId, scope, await resolveTenantUserId(ctx).catch(() => null));
  }

  @Patch('submissions/:submissionId')
  async updateSubmission(@Param('submissionId') submissionId: string, @Body() dto: UpdateSubmissionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    const scope = await this.scope(ctx);
    return this.inbox.updateSubmission(ctx, submissionId, scope, dto, await resolveTenantUserId(ctx).catch(() => null));
  }
}
