import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { reportEditScope, reportScope } from './report-scope.js';
import { ReportsService } from './reports.service.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { UpdateReportDto } from './dto/update-report.dto.js';
import { ReferReportDto } from './dto/refer-report.dto.js';
import { CreateReportCategoryDto } from './dto/create-category.dto.js';

function parseBool(v: string | undefined): boolean | undefined {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

/**
 * دسترسی گزارش‌ها سلسله‌مراتبی است (report-scope.ts): نویسنده، گیرندگان ارجاع، مدیران بالادستِ نویسنده
 * (فقط با «مشاهده‌ی همه») و OWNER/ADMIN. «فقط خودم» = نوشته‌ی خود + ارجاع‌شده به خود.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('categories')
  async listCategories(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'reports');
    return this.reports.listCategories(ctx);
  }

  @Post('categories')
  async createCategory(@Body() dto: CreateReportCategoryDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.createCategory(ctx, dto);
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    await this.permissions.assertViewAll(ctx, 'reports'); // دسته‌بندی داده‌ی مشترک است؛ حذفش فقط با «مشاهده‌ی همه»
    return this.reports.deleteCategory(ctx, id);
  }

  @Get()
  async list(
    @Query('categoryId') categoryId: string | undefined,
    @Query('isArchived') isArchived: string | undefined,
    @Query('isKnowledge') isKnowledge: string | undefined,
    @Query('referredToMe') referredToMe: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const scope = await reportScope(this.permissions, ctx);
    return this.reports.list(
      ctx,
      {
        categoryId,
        isArchived: parseBool(isArchived),
        isKnowledge: parseBool(isKnowledge),
        referredToMe: parseBool(referredToMe),
      },
      scope,
    );
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.reports.detail(ctx, id, await reportScope(this.permissions, ctx));
  }

  @Post()
  async create(@Body() dto: CreateReportDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'reports');
    return this.reports.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateReportDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.update(ctx, id, dto, await reportEditScope(this.permissions, ctx));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'reports');
    return this.reports.remove(ctx, id, await reportEditScope(this.permissions, ctx));
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.setArchived(ctx, id, true, await reportEditScope(this.permissions, ctx));
  }

  @Post(':id/unarchive')
  async unarchive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.setArchived(ctx, id, false, await reportEditScope(this.permissions, ctx));
  }

  @Post(':id/convert-to-knowledge')
  async convertToKnowledge(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.setKnowledge(ctx, id, true, await reportEditScope(this.permissions, ctx));
  }

  @Post(':id/unconvert-knowledge')
  async unconvertKnowledge(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.setKnowledge(ctx, id, false, await reportEditScope(this.permissions, ctx));
  }

  @Post(':id/refer')
  async refer(@Param('id') id: string, @Body() dto: ReferReportDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.refer(ctx, id, dto, await reportEditScope(this.permissions, ctx));
  }

  @Post(':id/referrals/:referralId/paraph')
  async paraphReferral(@Param('id') id: string, @Param('referralId') referralId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'reports');
    return this.reports.paraphReferral(ctx, id, referralId, await reportScope(this.permissions, ctx));
  }
}
