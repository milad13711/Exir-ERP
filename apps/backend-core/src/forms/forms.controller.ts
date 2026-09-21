import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { FormsService } from './forms.service.js';
import { CreateFormDto } from './dto/create-form.dto.js';
import { UpdateFormDto } from './dto/update-form.dto.js';

@Controller('forms')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('forms')
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('status') status: string | undefined, @Query('type') type: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'forms');
    return this.forms.list(ctx, { status, type });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'forms');
    return this.forms.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateFormDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'forms');
    return this.forms.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateFormDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    return this.forms.update(ctx, id, dto);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    return this.forms.setStatus(ctx, id, 'PUBLISHED');
  }

  @Post(':id/close')
  async close(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    return this.forms.setStatus(ctx, id, 'CLOSED');
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'forms');
    return this.forms.setStatus(ctx, id, 'DRAFT');
  }

  @Post(':id/delete')
  async delete(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'forms');
    return this.forms.delete(ctx, id);
  }

  @Get(':id/submissions')
  async listSubmissions(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'forms');
    return this.forms.listSubmissions(ctx, id);
  }

  @Get(':id/stats')
  async stats(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'forms');
    return this.forms.stats(ctx, id);
  }

  @Get('submissions/by-contact/:contactId')
  async listSubmissionsByContact(@Param('contactId') contactId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'forms');
    return this.forms.listSubmissionsByContact(ctx, contactId);
  }

  @Get('submissions/:submissionId')
  async submissionDetail(@Param('submissionId') submissionId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'forms');
    return this.forms.submissionDetail(ctx, submissionId);
  }
}
