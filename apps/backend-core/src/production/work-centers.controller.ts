import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateWorkCenterDto, UpdateWorkCenterDto } from './dto/create-work-center.dto.js';
import { normalizeName } from './bom-rules.js';

const WORK_CENTER_EXCEL_HEADERS = ['نام', 'ترتیب'];

@Controller('production/work-centers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class WorkCentersController {
  constructor(private readonly permissions: PermissionsService) {}

  /** status=active (پیش‌فرض، برای انتخاب‌گرها) | archived | all */
  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    const where = status === 'archived' ? { isActive: false } : status === 'all' ? {} : { isActive: true };
    const centers = await ctx.tenantDb.workCenter.findMany({
      where,
      orderBy: { sequenceOrder: 'asc' },
      include: { _count: { select: { stages: true } } },
    });
    return centers.map(({ _count, ...c }) => ({ ...c, usageCount: _count?.stages ?? 0 }));
  }

  private async assertUniqueName(ctx: TenantRequestContext, name: string, exceptId?: string) {
    const key = normalizeName(name);
    const all = await ctx.tenantDb.workCenter.findMany({ select: { id: true, name: true, isActive: true } });
    const dup = all.find((w) => w.id !== exceptId && normalizeName(w.name) === key);
    if (dup) {
      throw new ConflictException(
        dup.isActive ? 'ایستگاهی با این نام وجود دارد' : 'ایستگاهی با این نام در بایگانی وجود دارد؛ آن را بازیابی کنید یا نام دیگری بگذارید',
      );
    }
  }

  @Post()
  async create(@Body() dto: CreateWorkCenterDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'production');
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException('نام ایستگاه حداقل ۲ حرف است');
    await this.assertUniqueName(ctx, name);
    return ctx.tenantDb.workCenter.create({
      data: { name, sequenceOrder: dto.sequenceOrder ?? 0 },
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

  /** تغییر نام همیشه آزاد است (مراحل با شناسه به ایستگاه وصل‌اند). تغییر ترتیب فقط روی دستورهای جدید اثر دارد: مرحله‌های هر دستور هنگام ساخت snapshot می‌شوند. */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateWorkCenterDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const existing = await ctx.tenantDb.workCenter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ایستگاه تولید یافت نشد');
    const data: { name?: string; sequenceOrder?: number } = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) throw new BadRequestException('نام ایستگاه حداقل ۲ حرف است');
      await this.assertUniqueName(ctx, name, id);
      data.name = name;
    }
    if (dto.sequenceOrder !== undefined) data.sequenceOrder = dto.sequenceOrder;
    return ctx.tenantDb.workCenter.update({ where: { id }, data });
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const existing = await ctx.tenantDb.workCenter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ایستگاه تولید یافت نشد');
    if (!existing.isActive) throw new BadRequestException('این ایستگاه قبلاً بایگانی شده است');
    return ctx.tenantDb.workCenter.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } });
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const existing = await ctx.tenantDb.workCenter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ایستگاه تولید یافت نشد');
    if (existing.isActive) throw new BadRequestException('این ایستگاه بایگانی نیست');
    return ctx.tenantDb.workCenter.update({ where: { id }, data: { isActive: true, archivedAt: null } });
  }

  /** حذف قطعی فقط وقتی هیچ مرحله‌ی دستور تولیدی به ایستگاه وصل نیست؛ وگرنه فقط بایگانی. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'production');
    const existing = await ctx.tenantDb.workCenter.findUnique({ where: { id }, include: { _count: { select: { stages: true } } } });
    if (!existing) throw new NotFoundException('ایستگاه تولید یافت نشد');
    const usage = existing._count?.stages ?? 0;
    if (usage > 0) {
      throw new ConflictException(
        `این ایستگاه در ${usage} مرحله‌ی دستور تولید استفاده شده و حذف نمی‌شود تا تاریخچه حفظ شود. به‌جای حذف می‌توانید آن را بایگانی کنید.`,
      );
    }
    await ctx.tenantDb.workCenter.delete({ where: { id } });
    return { success: true };
  }
}
