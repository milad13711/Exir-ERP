import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateWorkCenterDto } from './dto/create-work-center.dto.js';

const WORK_CENTER_EXCEL_HEADERS = ['نام', 'ترتیب'];

@Controller('production/work-centers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class WorkCentersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    return ctx.tenantDb.workCenter.findMany({ orderBy: { sequenceOrder: 'asc' } });
  }

  @Post()
  async create(@Body() dto: CreateWorkCenterDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'production');
    return ctx.tenantDb.workCenter.create({
      data: { name: dto.name, sequenceOrder: dto.sequenceOrder ?? 0 },
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'production');
    const centers = await ctx.tenantDb.workCenter.findMany({ orderBy: { sequenceOrder: 'asc' } });
    const buffer = await buildExcelBuffer(
      WORK_CENTER_EXCEL_HEADERS,
      centers.map((c) => ({ نام: c.name, ترتیب: c.sequenceOrder })),
      'ایستگاه‌های تولید',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="work-centers.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'production');
    const buffer = await buildExcelBuffer(WORK_CENTER_EXCEL_HEADERS, [{ نام: 'خط تولید ۱', ترتیب: 1 }], 'نمونه');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="work-centers-template.xlsx"');
    res.send(buffer);
  }

  /** Upserts by نام (no unique constraint in schema, matched best-effort): an existing name updates ترتیب, a new name creates it. */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'production');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const name = String(row['نام'] ?? '').trim();
      if (!name) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نام خالی است' });
        continue;
      }
      const sequenceOrder = Number(row['ترتیب'] ?? 0) || 0;

      const existing = await ctx.tenantDb.workCenter.findFirst({ where: { name } });
      if (existing) {
        await ctx.tenantDb.workCenter.update({ where: { id: existing.id }, data: { sequenceOrder } });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.workCenter.create({ data: { name, sequenceOrder } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: CreateWorkCenterDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const existing = await ctx.tenantDb.workCenter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ایستگاه تولید یافت نشد');
    return ctx.tenantDb.workCenter.update({
      where: { id },
      data: { name: dto.name, sequenceOrder: dto.sequenceOrder ?? existing.sequenceOrder },
    });
  }
}
