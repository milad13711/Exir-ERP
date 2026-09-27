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
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultWarehouse } from './default-warehouse.js';
import { CostingService, computeSalePriceFromMargin } from './costing.service.js';

const PRODUCT_EXCEL_HEADERS = [
  'کد کالا',
  'نام',
  'واحد',
  'دسته‌بندی',
  'قیمت خرید',
  'درصد سود',
  'قیمت فروش',
  'موجودی',
  'نقطه سفارش مجدد',
];

@Controller('warehouse/products')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class ProductsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly costing: CostingService,
  ) {}

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
    const products = await ctx.tenantDb.product.findMany({
      where: { isActive: true },
      include: { movements: { select: { quantityDelta: true } } },
      orderBy: { name: 'asc' },
    });
    const buffer = await buildExcelBuffer(
      PRODUCT_EXCEL_HEADERS,
      products.map((p) => ({
        'کد کالا': p.sku,
        نام: p.name,
        واحد: p.unit,
        'دسته‌بندی': p.category ?? '',
        'قیمت خرید': p.costPrice,
        'درصد سود': p.profitMarginPercent != null ? Number(p.profitMarginPercent) : '',
        'قیمت فروش': p.salePrice,
        موجودی: currentStock(p.movements),
        'نقطه سفارش مجدد': p.reorderPoint,
      })),
      'کالاها',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
    res.send(buffer);
  }

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'warehouse');
    const buffer = await buildExcelBuffer(
      PRODUCT_EXCEL_HEADERS,
      [
        {
          'کد کالا': 'P-1001',
          نام: 'کالای نمونه',
          واحد: 'عدد',
          'دسته‌بندی': 'عمومی',
          'قیمت خرید': 200000,
          'درصد سود': 30,
          'قیمت فروش': '', // خالی بگذارید تا از «قیمت خرید × (۱ + درصد سود / ۱۰۰)» محاسبه شود
          موجودی: 10,
          'نقطه سفارش مجدد': 10,
        },
      ],
      'نمونه',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="products-template.xlsx"');
    res.send(buffer);
  }

  /**
   * Upserts by SKU (کد کالا): an existing SKU updates that product, a new
   * one creates it. Rows missing either کد کالا or نام are skipped rather
   * than failing the whole import — one bad row shouldn't block the rest.
   *
   * «درصد سود» + «قیمت خرید»: قیمت فروش خودکار از
   * salePrice = costPrice * (1 + profitPercent/100) محاسبه می‌شود (وقتی تنظیم
   * سراسری «محاسبه خودکار قیمت فروش از درصد سود» فعال باشد؛ اگر غیرفعال باشد
   * درصد سود همچنان ذخیره می‌شود ولی قیمت فروش دست‌نخورده از ستون «قیمت فروش»
   * می‌آید). «موجودی»: فقط برای ردیف‌های تازه‌ایجادشده (CREATED) یک رسید
   * ورودی افتتاحیه در انبار پیش‌فرض ثبت می‌شود — تا رسیدهای بعدی
   * از اکسل روی هر re-import تکراری نشوند.
   */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);
    const autoSalePriceEnabled = await this.costing.getAutoSalePriceEnabled(ctx);
    const userId = await resolveTenantUserId(ctx);

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

      const costPrice = Number(row['قیمت خرید'] ?? 0) || 0;
      const profitPercentRaw = row['درصد سود'];
      const profitMarginPercent =
        profitPercentRaw !== null && profitPercentRaw !== undefined && String(profitPercentRaw).trim() !== ''
          ? Number(profitPercentRaw) || 0
          : null;
      const salePriceFromMargin =
        autoSalePriceEnabled && profitMarginPercent != null && costPrice > 0
          ? computeSalePriceFromMargin(costPrice, profitMarginPercent)
          : null;
      const salePrice = salePriceFromMargin ?? (Number(row['قیمت فروش'] ?? 0) || 0);
      const openingStock = Number(row['موجودی'] ?? 0) || 0;

      const data = {
        name,
        unit: String(row['واحد'] ?? '').trim() || 'عدد',
        category: String(row['دسته‌بندی'] ?? '').trim() || undefined,
        costPrice,
        profitMarginPercent,
        salePrice,
        reorderPoint: Number(row['نقطه سفارش مجدد'] ?? 0) || 0,
      };

      // ستون «درصد سود» پر شده و محاسبه‌ی خودکار انجام شده = همان «اعمال دوباره‌ی
      // درصد سود» است، پس salePriceSource به AUTO برمی‌گردد (حتی اگر قبلاً روی
      // این کالا MANUAL شده بود).
      const salePriceSourceUpdate = salePriceFromMargin != null ? ({ salePriceSource: 'AUTO' } as const) : {};

      const existing = await ctx.tenantDb.product.findUnique({ where: { sku } });
      let productId: string;
      if (existing) {
        await ctx.tenantDb.product.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...salePriceSourceUpdate,
            ...(salePriceFromMargin != null ? { salePriceUpdatedAt: new Date() } : {}),
          },
        });
        productId = existing.id;
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        const created = await ctx.tenantDb.product.create({
          data: { sku, ...data, ...salePriceSourceUpdate, salePriceUpdatedAt: salePrice > 0 ? new Date() : undefined },
        });
        productId = created.id;
        results.push({ row: rowNumber, status: 'CREATED' });

        if (openingStock > 0) {
          const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);
          await ctx.tenantDb.stockMovement.create({
            data: {
              productId,
              warehouseId: warehouse.id,
              type: 'RECEIPT',
              quantityDelta: openingStock,
              unitCost: costPrice > 0 ? costPrice : undefined,
              reference: 'رسید افتتاحیه — ورود اکسل',
              createdByUserId: userId,
            },
          });
        }
      }
    }

    return summarize(results);
  }

  @Post()
  async create(@Body() dto: CreateProductDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    const existing = await ctx.tenantDb.product.findUnique({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException('کالایی با این کد از قبل وجود دارد');

    // اگر درصد سود داده شده باشد (و تنظیم سراسری فعال باشد)، قیمت فروش از
    // روی بهای تمام‌شده محاسبه می‌شود — قیمت فروش دستی ارسالی نادیده گرفته
    // می‌شود چون این یک کالای تازه است، نه یک بازنویسی روی مقدار قبلی.
    const autoSalePriceEnabled = await this.costing.getAutoSalePriceEnabled(ctx);
    const costPrice = dto.costPrice ?? 0;
    const salePriceFromMargin =
      autoSalePriceEnabled && dto.profitMarginPercent != null
        ? computeSalePriceFromMargin(costPrice, dto.profitMarginPercent)
        : null;
    const salePrice = salePriceFromMargin ?? dto.salePrice ?? 0;

    const product = await ctx.tenantDb.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        unit: dto.unit ?? 'عدد',
        category: dto.category,
        costPrice,
        salePrice,
        profitMarginPercent: dto.profitMarginPercent,
        salePriceUpdatedAt: salePrice > 0 ? new Date() : undefined,
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

    /**
     * قاعده‌ی کسب‌وکار override دستی: این PATCH همان «مسیر ویرایش عادی کالا»ست
     * (نه بازمحاسبه‌ی خودکار روی رسید). دو حالت:
     *  ۱) dto.profitMarginPercent ست شده → یعنی فروشنده دارد دوباره درصد سود
     *     را ذخیره می‌کند؛ این «اعمال دوباره‌ی درصد سود» است، پس قیمت فروش از
     *     بهای تمام‌شده‌ی تازه (dto.costPrice اگر همزمان عوض شده، وگرنه فعلی)
     *     بازمحاسبه و salePriceSource دوباره AUTO می‌شود — این تنها راه
     *     بازگشت یک کالای MANUAL‌شده به حالت خودکار است.
     *  ۲) وگرنه اگر dto.salePrice مقداری متفاوت از قبل دارد → یعنی فروشنده
     *     مستقیماً قیمت فروش را ویرایش کرده (نوسان بازار/تورم)؛ salePriceSource
     *     روی MANUAL می‌رود تا رسیدهای بعدی این override را دست نزنند، تا
     *     دوباره درصد سود صریحاً اعمال شود.
     * اگر تنظیم سراسری غیرفعال باشد، درصد سود هنوز ذخیره می‌شود ولی قیمت
     * فروش/منبع آن دست‌نخورده باقی می‌ماند.
     */
    const autoSalePriceEnabled = await this.costing.getAutoSalePriceEnabled(ctx);
    let salePricePatch: { salePrice?: number; salePriceSource?: 'AUTO' | 'MANUAL'; salePriceUpdatedAt?: Date } = {};
    if (dto.profitMarginPercent != null) {
      if (autoSalePriceEnabled) {
        const baseCost = dto.costPrice ?? existing.costPrice;
        salePricePatch = {
          salePrice: computeSalePriceFromMargin(baseCost, dto.profitMarginPercent),
          salePriceSource: 'AUTO',
          salePriceUpdatedAt: new Date(),
        };
      }
    } else if (dto.salePrice != null && dto.salePrice !== existing.salePrice) {
      salePricePatch = { salePrice: dto.salePrice, salePriceSource: 'MANUAL', salePriceUpdatedAt: new Date() };
    }

    const product = await ctx.tenantDb.product.update({
      where: { id },
      data: {
        sku: dto.sku,
        name: dto.name,
        unit: dto.unit,
        category: dto.category,
        costPrice: dto.costPrice,
        profitMarginPercent: dto.profitMarginPercent,
        reorderPoint: dto.reorderPoint,
        currencyId: clearingCurrency ? null : dto.currencyId,
        costPriceFx: clearingCurrency ? null : dto.costPriceFx,
        salePriceFx: clearingCurrency ? null : dto.salePriceFx,
        ...salePricePatch,
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
