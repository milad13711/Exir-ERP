import {
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';

const SUPPLIER_EXCEL_HEADERS = ['نام', 'شرکت', 'تلفن', 'ایمیل', 'آدرس'];

/**
 * "Supplier" here is just a CrmContact with `isSupplier: true` — the same
 * party model customers use. This keeps one ledger/check history per
 * real-world entity even when they're both a customer and a supplier,
 * instead of two disconnected records (see [[project_admin_platform_status]]
 * for why the old separate Supplier model was retired).
 */
@Controller('purchasing/suppliers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('purchasing')
export class SuppliersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Query('q') q: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'purchasing');
    return ctx.tenantDb.crmContact.findMany({
      where: {
        isSupplier: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { company: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'purchasing');
    const suppliers = await ctx.tenantDb.crmContact.findMany({ where: { isSupplier: true }, orderBy: { name: 'asc' } });
    const buffer = await buildExcelBuffer(
      SUPPLIER_EXCEL_HEADERS,
      suppliers.map((s) => ({
        نام: s.name,
        شرکت: s.company ?? '',
        تلفن: s.phone ?? '',
        ایمیل: s.email ?? '',
        آدرس: s.address ?? '',
      })),
      'تأمین‌کنندگان',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="suppliers.xlsx"');
    res.send(buffer);
  }

  /**
   * Best-effort dedup by phone (same rule as CreateSupplierDto's own match
   * logic): a non-empty phone matching an existing contact flips
   * isSupplier on it instead of creating a duplicate party. Rows with no
   * نام are skipped.
   */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'purchasing');
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

      const phone = String(row['تلفن'] ?? '').trim() || undefined;
      const data = {
        company: String(row['شرکت'] ?? '').trim() || undefined,
        email: String(row['ایمیل'] ?? '').trim() || undefined,
        address: String(row['آدرس'] ?? '').trim() || undefined,
      };

      const existing = phone ? await ctx.tenantDb.crmContact.findFirst({ where: { phone } }) : null;
      if (existing) {
        await ctx.tenantDb.crmContact.update({
          where: { id: existing.id },
          data: {
            isSupplier: true,
            company: existing.company ?? data.company,
            email: existing.email ?? data.email,
            address: existing.address ?? data.address,
          },
        });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.crmContact.create({
          data: { name, phone, ...data, isCustomer: false, isSupplier: true },
        });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'purchasing');
    const supplier = await ctx.tenantDb.crmContact.findFirst({ where: { id, isSupplier: true } });
    if (!supplier) throw new NotFoundException('تأمین‌کننده یافت نشد');
    return supplier;
  }

  /**
   * If an existing contact matches by phone, just flips isSupplier on them
   * instead of creating a duplicate party — this is the whole point of the
   * unified model: one real person shouldn't get two disconnected records.
   */
  @Post()
  async create(@Body() dto: CreateSupplierDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'purchasing');
    if (dto.phone) {
      const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone: dto.phone } });
      if (existing) {
        return ctx.tenantDb.crmContact.update({
          where: { id: existing.id },
          data: {
            isSupplier: true,
            company: existing.company ?? dto.company,
            email: existing.email ?? dto.email,
            address: existing.address ?? dto.address,
          },
        });
      }
    }
    return ctx.tenantDb.crmContact.create({
      data: { ...dto, isCustomer: false, isSupplier: true },
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'purchasing');
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { id, isSupplier: true } });
    if (!existing) throw new NotFoundException('تأمین‌کننده یافت نشد');
    return ctx.tenantDb.crmContact.update({ where: { id }, data: dto });
  }

  /**
   * Supplier.id is a required (RESTRICT) FK on PurchaseOrder — block delete
   * instead of letting Postgres throw. Since this is now a shared party
   * record, "delete" only ever turns isSupplier off (never a hard delete —
   * the same contact might still be a customer, or have its own history).
   */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'purchasing');
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { id, isSupplier: true } });
    if (!existing) throw new NotFoundException('تأمین‌کننده یافت نشد');
    const orderCount = await ctx.tenantDb.purchaseOrder.count({ where: { supplierId: id } });
    if (orderCount > 0) {
      throw new ConflictException('این تأمین‌کننده سفارش خرید ثبت‌شده دارد و قابل حذف نیست');
    }
    if (existing.isCustomer) {
      await ctx.tenantDb.crmContact.update({ where: { id }, data: { isSupplier: false } });
    } else {
      await ctx.tenantDb.crmContact.delete({ where: { id } });
    }
    return { success: true };
  }
}
