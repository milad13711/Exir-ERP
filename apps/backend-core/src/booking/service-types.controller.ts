import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { ServiceTypesService } from './service-types.service.js';
import { CreateServiceTypeDto } from './dto/create-service-type.dto.js';
import { UpdateServiceTypeDto } from './dto/update-service-type.dto.js';

const SERVICE_TYPE_EXCEL_HEADERS = ['نام', 'مدت (دقیقه)', 'قیمت', 'نیاز به پیش‌پرداخت', 'مقدار پیش‌پرداخت'];

@Controller('booking/service-types')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('booking')
export class ServiceTypesController {
  constructor(
    private readonly serviceTypes: ServiceTypesService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('includeInactive') includeInactive: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'booking');
    return this.serviceTypes.list(ctx, includeInactive === 'true');
  }

  @Post()
  async create(@Body() dto: CreateServiceTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'booking');
    return this.serviceTypes.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateServiceTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'booking');
    return this.serviceTypes.update(ctx, id, dto);
  }

  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'booking');
    return this.serviceTypes.deactivate(ctx, id);
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'booking');
    const types = await this.serviceTypes.list(ctx, true);
    const buffer = await buildExcelBuffer(
      SERVICE_TYPE_EXCEL_HEADERS,
      types.map((t) => ({
        نام: t.name,
        'مدت (دقیقه)': t.durationMinutes,
        قیمت: t.price,
        'نیاز به پیش‌پرداخت': t.requiresDeposit ? 'بلی' : 'خیر',
        'مقدار پیش‌پرداخت': t.depositAmount ?? '',
      })),
      'انواع خدمت',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="service-types.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'booking');
    const buffer = await buildExcelBuffer(
      SERVICE_TYPE_EXCEL_HEADERS,
      [{ نام: 'مشاوره اولیه', 'مدت (دقیقه)': 30, قیمت: 200000, 'نیاز به پیش‌پرداخت': 'خیر', 'مقدار پیش‌پرداخت': '' }],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="service-types-template.xlsx"');
    res.send(buffer);
  }

  /** Upserts by نام (no unique constraint in schema, matched best-effort). */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'booking');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const name = String(row['نام'] ?? '').trim();
      const durationMinutes = Number(row['مدت (دقیقه)'] ?? 0) || 0;
      if (!name || durationMinutes < 5) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نام خالی یا مدت کمتر از ۵ دقیقه است' });
        continue;
      }
      const requiresDeposit = String(row['نیاز به پیش‌پرداخت'] ?? '').trim() === 'بلی';
      const data = {
        name,
        durationMinutes,
        price: Number(row['قیمت'] ?? 0) || 0,
        requiresDeposit,
        depositAmount: requiresDeposit ? Number(row['مقدار پیش‌پرداخت'] ?? 0) || 0 : undefined,
      };

      const existing = await ctx.tenantDb.serviceType.findFirst({ where: { name } });
      if (existing) {
        await ctx.tenantDb.serviceType.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.serviceType.create({ data });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }
}
