import { Body, Controller, Get, Post, Res, UseGuards, ConflictException, Delete, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateTestTypeDto } from './dto/create-test-type.dto.js';
import { UpdateTestTypeDto } from './dto/update-test-type.dto.js';

const TEST_TYPE_EXCEL_HEADERS = ['نام', 'واحد', 'حداقل قابل قبول', 'حداکثر قابل قبول', 'توضیحات'];

@Controller('quality-control/test-types')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('quality-control')
export class TestTypesController {
  constructor(private readonly permissions: PermissionsService) {}

  /** status=active (پیش‌فرض، برای انتخاب‌گرها) | archived | all */
  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'quality-control');
    const where = status === 'archived' ? { isActive: false } : status === 'all' ? {} : { isActive: true };
    const rows = await ctx.tenantDb.qualityTestType.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { results: true } } } });
    return rows.map(({ _count, ...t }) => ({ ...t, usageCount: _count.results }));
  }

  @Post()
  async create(@Body() dto: CreateTestTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'quality-control');
    return ctx.tenantDb.qualityTestType.create({
      data: {
        name: dto.name,
        unit: dto.unit,
        acceptableMin: dto.acceptableMin,
        acceptableMax: dto.acceptableMax,
        description: dto.description,
      },
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'quality-control');
    const types = await ctx.tenantDb.qualityTestType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    const buffer = await buildExcelBuffer(
      TEST_TYPE_EXCEL_HEADERS,
      types.map((t) => ({
        نام: t.name,
        واحد: t.unit,
        'حداقل قابل قبول': t.acceptableMin != null ? Number(t.acceptableMin) : '',
        'حداکثر قابل قبول': t.acceptableMax != null ? Number(t.acceptableMax) : '',
        توضیحات: t.description ?? '',
      })),
      'انواع آزمون',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="test-types.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'quality-control');
    const buffer = await buildExcelBuffer(
      TEST_TYPE_EXCEL_HEADERS,
      [{ نام: 'رطوبت', واحد: '%', 'حداقل قابل قبول': 0, 'حداکثر قابل قبول': 14, توضیحات: '' }],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="test-types-template.xlsx"');
    res.send(buffer);
  }

  /** Upserts by نام (no unique constraint in schema, matched best-effort). */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'quality-control');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const name = String(row['نام'] ?? '').trim();
      const unit = String(row['واحد'] ?? '').trim();
      if (!name || !unit) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نام یا واحد خالی است' });
        continue;
      }
      const minRaw = row['حداقل قابل قبول'];
      const maxRaw = row['حداکثر قابل قبول'];
      const data = {
        name,
        unit,
        acceptableMin: minRaw === null || minRaw === '' || minRaw === undefined ? undefined : Number(minRaw),
        acceptableMax: maxRaw === null || maxRaw === '' || maxRaw === undefined ? undefined : Number(maxRaw),
        description: String(row['توضیحات'] ?? '').trim() || undefined,
      };

      const existing = await ctx.tenantDb.qualityTestType.findFirst({ where: { name } });
      if (existing) {
        await ctx.tenantDb.qualityTestType.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.qualityTestType.create({ data });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTestTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'quality-control');
    const t = await ctx.tenantDb.qualityTestType.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('نوع آزمون یافت نشد');
    return ctx.tenantDb.qualityTestType.update({ where: { id }, data: dto });
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'quality-control');
    const t = await ctx.tenantDb.qualityTestType.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('نوع آزمون یافت نشد');
    return ctx.tenantDb.qualityTestType.update({ where: { id }, data: { isActive: false } });
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'quality-control');
    const t = await ctx.tenantDb.qualityTestType.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('نوع آزمون یافت نشد');
    return ctx.tenantDb.qualityTestType.update({ where: { id }, data: { isActive: true } });
  }

  /** حذف قطعی فقط اگر در هیچ نتیجه‌ی آزمایشی استفاده نشده؛ وگرنه بایگانی. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'quality-control');
    const t = await ctx.tenantDb.qualityTestType.findUnique({ where: { id }, include: { _count: { select: { results: true } } } });
    if (!t) throw new NotFoundException('نوع آزمون یافت نشد');
    if (t._count.results > 0) {
      throw new ConflictException(`این نوع آزمون در ${t._count.results} نتیجه‌ی آزمایش استفاده شده و حذف نمی‌شود تا تاریخچه حفظ شود. به‌جای حذف می‌توانید آن را بایگانی کنید.`);
    }
    await ctx.tenantDb.qualityTestType.delete({ where: { id } });
    return { success: true };
  }
}
