import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateTemplateDto, RenderTemplateDto, UpdateTemplateDto } from './dto/template.dto.js';
import { PLACEHOLDER_LABELS, TEMPLATE_PLACEHOLDERS } from './templates.apply.js';
import { TemplatesService } from './templates.service.js';

@Controller('correspondence/templates')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('correspondence')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('placeholders')
  async placeholders(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return TEMPLATE_PLACEHOLDERS.map((key) => ({ key, token: `{{${key}}}`, label: PLACEHOLDER_LABELS[key] }));
  }

  @Get()
  async list(@Query('letterType') letterType: string | undefined, @Query('activeOnly') activeOnly: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return this.templates.list(ctx, { letterType, activeOnly: activeOnly === '1' || activeOnly === 'true' });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return this.templates.get(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.templates.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.templates.update(ctx, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.templates.remove(ctx, id);
  }

  /** رندر قالب با مقدارهای واقعی (برای ایجاد پیش‌نویس) یا نمونه. مقدار نداده‌شده: ?sample=1 → نمونه، وگرنه جانشین دست‌نخورده. */
  @Post(':id/render')
  async render(@Param('id') id: string, @Body() dto: RenderTemplateDto, @Query('sample') sample: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return this.templates.renderPreview(ctx, id, dto.context, sample === '1' || sample === 'true');
  }
}
