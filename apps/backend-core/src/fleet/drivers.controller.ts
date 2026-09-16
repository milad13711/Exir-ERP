import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { DriversService } from './drivers.service.js';
import { CreateDriverDto } from './dto/create-driver.dto.js';
import { UpdateDriverDto } from './dto/update-driver.dto.js';

const DRIVER_EXCEL_HEADERS = ['نام', 'تلفن', 'نوع خودرو', 'پلاک', 'ظرفیت (کیلوگرم)', 'مناطق سرویس'];

@Controller('fleet/drivers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('fleet')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('isActive') isActive: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'fleet');
    return this.drivers.list(ctx, { isActive: isActive === undefined ? undefined : isActive === 'true' });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'fleet');
    const drivers = await this.drivers.list(ctx, {});
    const buffer = await buildExcelBuffer(
      DRIVER_EXCEL_HEADERS,
      drivers.map((d) => ({
        نام: d.name,
        تلفن: d.phone,
        'نوع خودرو': d.vehicleType ?? '',
        پلاک: d.plateNumber ?? '',
        'ظرفیت (کیلوگرم)': d.capacityKg ?? '',
        'مناطق سرویس': d.serviceAreas.join('، '),
      })),
      'راننده‌ها',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="drivers.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'fleet');
    const buffer = await buildExcelBuffer(
      DRIVER_EXCEL_HEADERS,
      [
        {
          نام: 'رضا احمدی',
          تلفن: '09121234567',
          'نوع خودرو': 'وانت',
          پلاک: '۱۲ب۳۴۵-۶۷',
          'ظرفیت (کیلوگرم)': 1000,
          'مناطق سرویس': 'تهران، کرج',
        },
      ],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="drivers-template.xlsx"');
    res.send(buffer);
  }

  /** Best-effort dedup by تلفن (not unique in schema): a matching phone updates that driver, otherwise a new one is created. */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'fleet');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const name = String(row['نام'] ?? '').trim();
      const phone = String(row['تلفن'] ?? '').trim();
      if (!name || !phone) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نام یا تلفن خالی است' });
        continue;
      }
      const data = {
        name,
        phone,
        vehicleType: String(row['نوع خودرو'] ?? '').trim() || undefined,
        plateNumber: String(row['پلاک'] ?? '').trim() || undefined,
        capacityKg: Number(row['ظرفیت (کیلوگرم)'] ?? 0) || undefined,
        serviceAreas: String(row['مناطق سرویس'] ?? '')
          .split(/[،,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };

      const existing = await ctx.tenantDb.driver.findFirst({ where: { phone } });
      if (existing) {
        await ctx.tenantDb.driver.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.driver.create({ data });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Post()
  async create(@Body() dto: CreateDriverDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'fleet');
    return this.drivers.create(ctx, dto);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'fleet');
    return this.drivers.detail(ctx, id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDriverDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'fleet');
    return this.drivers.update(ctx, id, dto);
  }

  @Delete(':id')
  async deactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'fleet');
    return this.drivers.deactivate(ctx, id);
  }
}
