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
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto.js';

const DISCOUNT_CODE_EXCEL_HEADERS = ['کد', 'درصد تخفیف', 'تاریخ انقضا', 'حداکثر تعداد استفاده'];

/** کدهای تخفیف روی هزینه‌ی آنالیز نمونه — کد با percentOff=100 آنالیز را کاملاً رایگان می‌کند. */
@Controller('ration-lab/discount-codes')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationDiscountCodesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'ration-lab');
    return ctx.tenantDb.rationDiscountCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@Body() dto: CreateDiscountCodeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');
    return ctx.tenantDb.rationDiscountCode.create({
      data: {
        code: dto.code,
        percentOff: dto.percentOff,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        maxRedemptions: dto.maxRedemptions,
      },
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'ration-lab');
    const codes = await ctx.tenantDb.rationDiscountCode.findMany({ orderBy: { code: 'asc' } });
    const buffer = await buildExcelBuffer(
      DISCOUNT_CODE_EXCEL_HEADERS,
      codes.map((c) => ({
        کد: c.code,
        'درصد تخفیف': c.percentOff,
        'تاریخ انقضا': c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : '',
        'حداکثر تعداد استفاده': c.maxRedemptions ?? '',
      })),
      'کدهای تخفیف',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="discount-codes.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'ration-lab');
    const buffer = await buildExcelBuffer(
      DISCOUNT_CODE_EXCEL_HEADERS,
      [{ کد: 'WELCOME100', 'درصد تخفیف': 100, 'تاریخ انقضا': '', 'حداکثر تعداد استفاده': '' }],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="discount-codes-template.xlsx"');
    res.send(buffer);
  }

  /** Upserts by کد (unique). */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const code = String(row['کد'] ?? '').trim();
      const percentOff = Number(row['درصد تخفیف'] ?? 0) || 0;
      if (!code || percentOff < 1 || percentOff > 100) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'کد خالی یا درصد تخفیف نامعتبر است' });
        continue;
      }
      const expiresAtRaw = String(row['تاریخ انقضا'] ?? '').trim();
      const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : undefined;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'تاریخ انقضا نامعتبر است' });
        continue;
      }
      const maxRedemptionsRaw = row['حداکثر تعداد استفاده'];
      const data = {
        percentOff,
        expiresAt,
        maxRedemptions:
          maxRedemptionsRaw === null || maxRedemptionsRaw === '' || maxRedemptionsRaw === undefined
            ? undefined
            : Number(maxRedemptionsRaw),
      };

      const existing = await ctx.tenantDb.rationDiscountCode.findUnique({ where: { code } });
      if (existing) {
        await ctx.tenantDb.rationDiscountCode.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.rationDiscountCode.create({ data: { code, ...data } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    const code = await ctx.tenantDb.rationDiscountCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('کد تخفیف یافت نشد');
    return ctx.tenantDb.rationDiscountCode.update({ where: { id }, data: { isActive: false } });
  }
}
