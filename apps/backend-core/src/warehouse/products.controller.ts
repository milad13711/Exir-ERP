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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { currentStock, stockByWarehouse } from './stock.js';
import { withFxPrices } from './fx-price.js';

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
