import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto.js';

const DEPARTMENT_EXCEL_HEADERS = ['نام واحد'];

const DEPARTMENT_INCLUDE = {
  manager: { select: { id: true, fullName: true } },
  _count: { select: { employees: true } },
} as const;

/** واحد سازمانی — یک مدیر مشخص که ناظر تمام پرونده‌های پرسنلی اعضای همان واحد است (org-chain.util.ts). */
@Controller('hr/departments')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class DepartmentsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'hr');
    return ctx.tenantDb.department.findMany({ include: DEPARTMENT_INCLUDE, orderBy: { name: 'asc' } });
  }

  @Post()
  async create(@Body() dto: CreateDepartmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // مدیرِ واحد تعیین‌کننده‌ی دیدِ پرونده‌هاست — فقط با «مشاهده‌ی همه»
    const existing = await ctx.tenantDb.department.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('واحدی با این نام از قبل وجود دارد');
    return ctx.tenantDb.department.create({
      data: { name: dto.name, managerId: dto.managerId },
      include: DEPARTMENT_INCLUDE,
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'hr');
    const departments = await ctx.tenantDb.department.findMany({ orderBy: { name: 'asc' } });
    const buffer = await buildExcelBuffer(
      DEPARTMENT_EXCEL_HEADERS,
      departments.map((d) => ({ 'نام واحد': d.name })),
      'واحدهای سازمانی',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="departments.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'hr');
    const buffer = await buildExcelBuffer(DEPARTMENT_EXCEL_HEADERS, [{ 'نام واحد': 'واحد مالی' }], 'نمونه');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="departments-template.xlsx"');
    res.send(buffer);
  }

  /** Rows whose نام واحد already exists are skipped — managers are assigned from the list afterward, not through import. */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // مدیرِ واحد تعیین‌کننده‌ی دیدِ پرونده‌هاست — فقط با «مشاهده‌ی همه»
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const name = String(row['نام واحد'] ?? '').trim();
      if (!name) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نام واحد خالی است' });
        continue;
      }
      const existing = await ctx.tenantDb.department.findUnique({ where: { name } });
      if (existing) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'واحدی با این نام از قبل وجود دارد' });
        continue;
      }
      await ctx.tenantDb.department.create({ data: { name } });
      results.push({ row: rowNumber, status: 'CREATED' });
    }

    return summarize(results);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // مدیرِ واحد تعیین‌کننده‌ی دیدِ پرونده‌هاست — فقط با «مشاهده‌ی همه»
    const existing = await ctx.tenantDb.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('واحد سازمانی یافت نشد');
    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await ctx.tenantDb.department.findUnique({ where: { name: dto.name } });
      if (nameTaken) throw new ConflictException('واحدی با این نام از قبل وجود دارد');
    }
    return ctx.tenantDb.department.update({
      where: { id },
      data: { name: dto.name, managerId: dto.managerId },
      include: DEPARTMENT_INCLUDE,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // مدیرِ واحد تعیین‌کننده‌ی دیدِ پرونده‌هاست — فقط با «مشاهده‌ی همه»
    const existing = await ctx.tenantDb.department.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
    if (!existing) throw new NotFoundException('واحد سازمانی یافت نشد');
    if (existing._count.employees > 0) {
      throw new ConflictException('این واحد سازمانی هنوز کارمند دارد — ابتدا کارمندان را به واحد دیگری منتقل کنید');
    }
    await ctx.tenantDb.department.delete({ where: { id } });
    return { success: true };
  }
}
