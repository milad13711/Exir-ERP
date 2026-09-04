import {
  Body,
  ConflictException,
  Controller,
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
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { currentStock, stockByWarehouse } from './stock.js';
import { withFxPrices } from './fx-price.js';

const PRODUCT_EXCEL_HEADERS = ['کد کالا', 'نام', 'واحد', 'دسته‌بندی', 'قیمت خرید', 'قیمت فروش', 'نقطه سفارش مجدد'];

@Controller('warehouse/products')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class ProductsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(
    @Query('q') q: string | undefined,
    @Query('includeInactive') includeInactive: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'warehouse');
    const products = await ctx.tenantDb.product.findMany({
      where: {
        ...(includeInactive === 'true' ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { category: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { movements: { select: { quantityDelta: true } }, currency: true },
      orderBy: { createdAt: 'desc' },
    });
    return products.map(({ movements, ...product }) => {
      const stock = currentStock(movements);
      return {
        ...withFxPrices(product),
        stock,
        isLowStock: product.reorderPoint > 0 && stock <= product.reorderPoint,
      };
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'warehouse');
    const products = await ctx.tenantDb.product.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    const buffer = await buildExcelBuffer(
      PRODUCT_EXCEL_HEADERS,
      products.map((p) => ({
        'کد کالا': p.sku,
        نام: p.name,
        واحد: p.unit,
        'دسته‌بندی': p.category ?? '',
        'قیمت خرید': p.costPrice,
        'قیمت فروش': p.salePrice,
        'نقطه سفارش مجدد': p.reorderPoint,
      })),
      'کالاها',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
    res.send(buffer);
  }

  /**
   * Upserts by SKU (کد کالا): an existing SKU updates that product, a new
   * one creates it. Rows missing either کد کالا or نام are skipped rather
   * than failing the whole import — one bad row shouldn't block the rest.
   */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // header is row 1
      const sku = String(row['کد کالا'] ?? '').trim();
      const name = String(row['نام'] ?? '').trim();
      if (!sku || !name) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'کد کالا یا نام خالی است' });
        continue;
      }

      const data = {
        name,
        unit: String(row['واحد'] ?? '').trim() || 'عدد',
        category: String(row['دسته‌بندی'] ?? '').trim() || undefined,
        costPrice: Number(row['قیمت خرید'] ?? 0) || 0,
        salePrice: Number(row['قیمت فروش'] ?? 0) || 0,
        reorderPoint: Number(row['نقطه سفارش مجدد'] ?? 0) || 0,
      };

      const existing = await ctx.tenantDb.product.findUnique({ where: { sku } });
      if (existing) {
        await ctx.tenantDb.product.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.product.create({ data: { sku, ...data } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Post()
  async create(@Body() dto: CreateProductDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    const existing = await ctx.tenantDb.product.findUnique({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException('کالایی با این کد از قبل وجود دارد');
    const product = await ctx.tenantDb.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        unit: dto.unit ?? 'عدد',
        category: dto.category,
        costPrice: dto.costPrice ?? 0,
        salePrice: dto.salePrice ?? 0,
        reorderPoint: dto.reorderPoint ?? 0,
        currencyId: dto.currencyId || undefined,
        costPriceFx: dto.costPriceFx,
        salePriceFx: dto.salePriceFx,
      },
      include: { currency: true },
    });
    return { ...withFxPrices(product), stock: 0, isLowStock: false };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warehouse');
    const product = await ctx.tenantDb.product.findUnique({
      where: { id },
      include: {
        currency: true,
        movements: {
          orderBy: { createdAt: 'desc' },
          include: { createdBy: { select: { name: true } }, warehouse: { select: { id: true, name: true } } },
        },
      },
    });
    if (!product) throw new NotFoundException('کالا یافت نشد');
    const stock = currentStock(product.movements);
    return {
      ...withFxPrices(product),
      stock,
      isLowStock: product.reorderPoint > 0 && stock <= product.reorderPoint,
      stockByWarehouse: stockByWarehouse(product.movements),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warehouse');
    const existing = await ctx.tenantDb.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('کالا یافت نشد');
    if (dto.sku && dto.sku !== existing.sku) {
      const skuTaken = await ctx.tenantDb.product.findUnique({ where: { sku: dto.sku } });
      if (skuTaken) throw new ConflictException('کالایی با این کد از قبل وجود دارد');
    }
    const clearingCurrency = dto.currencyId === '';
    const product = await ctx.tenantDb.product.update({
      where: { id },
      data: {
        sku: dto.sku,
        name: dto.name,
        unit: dto.unit,
        category: dto.category,
        costPrice: dto.costPrice,
        salePrice: dto.salePrice,
        reorderPoint: dto.reorderPoint,
        currencyId: clearingCurrency ? null : dto.currencyId,
        costPriceFx: clearingCurrency ? null : dto.costPriceFx,
        salePriceFx: clearingCurrency ? null : dto.salePriceFx,
      },
      include: { currency: true },
    });
    return withFxPrices(product);
  }

  /**
   * Soft-delete only — a Product is referenced by SalesInvoiceLine and
   * PurchaseOrderLine (RESTRICT) and cascades to StockMovement, so a hard
   * DELETE would either fail on any product with sales/purchase history or
   * silently wipe its stock-movement history. `isActive: false` hides it
   * from the default catalog list without touching that history.
   */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'warehouse');
    const existing = await ctx.tenantDb.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('کالا یافت نشد');
    await ctx.tenantDb.product.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }
}
