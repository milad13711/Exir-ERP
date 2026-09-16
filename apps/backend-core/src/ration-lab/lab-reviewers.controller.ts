import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateLabReviewerDto, UpdateLabReviewerDto } from './dto/create-lab-reviewer.dto.js';

const LAB_REVIEWER_EXCEL_HEADERS = ['شماره تماس', 'نام'];

/** لیست سفید شماره‌هایی که پورتال عمومی «آزمایشگاه جیره» به‌عنوان کارشناس آزمایشگاه می‌پذیرد — بدون اکانت کامل در این تننت. */
@Controller('ration-lab/reviewers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationLabReviewersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'ration-lab');
    return ctx.tenantDb.rationLabReviewer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@Body() dto: CreateLabReviewerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');
    return ctx.tenantDb.rationLabReviewer.create({ data: { phone: dto.phone, name: dto.name } });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'ration-lab');
    const reviewers = await ctx.tenantDb.rationLabReviewer.findMany({ orderBy: { name: 'asc' } });
    const buffer = await buildExcelBuffer(
      LAB_REVIEWER_EXCEL_HEADERS,
      reviewers.map((r) => ({ 'شماره تماس': r.phone, نام: r.name })),
      'کارشناسان آزمایشگاه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="lab-reviewers.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'ration-lab');
    const buffer = await buildExcelBuffer(
      LAB_REVIEWER_EXCEL_HEADERS,
      [{ 'شماره تماس': '09121234567', نام: 'کارشناس نمونه' }],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="lab-reviewers-template.xlsx"');
    res.send(buffer);
  }

  /** Upserts by شماره تماس (unique). */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const phone = String(row['شماره تماس'] ?? '').trim();
      const name = String(row['نام'] ?? '').trim();
      if (!phone || !name) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'شماره تماس یا نام خالی است' });
        continue;
      }

      const existing = await ctx.tenantDb.rationLabReviewer.findUnique({ where: { phone } });
      if (existing) {
        await ctx.tenantDb.rationLabReviewer.update({ where: { id: existing.id }, data: { name } });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.rationLabReviewer.create({ data: { phone, name } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateLabReviewerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    const reviewer = await ctx.tenantDb.rationLabReviewer.findUnique({ where: { id } });
    if (!reviewer) throw new NotFoundException('کارشناس آزمایشگاه یافت نشد');
    return ctx.tenantDb.rationLabReviewer.update({ where: { id }, data: { name: dto.name, isActive: dto.isActive } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'ration-lab');
    const reviewer = await ctx.tenantDb.rationLabReviewer.findUnique({ where: { id } });
    if (!reviewer) throw new NotFoundException('کارشناس آزمایشگاه یافت نشد');
    await ctx.tenantDb.rationLabReviewer.delete({ where: { id } });
    return { success: true };
  }
}
