import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { currentStock } from '../warehouse/stock.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';

/**
 * مدیریت نمایش عمومی کالاها — کدام کالا در نمای فروشگاه آنلاین دیده شود،
 * با چه توضیح/تصویری. خودِ کالا (قیمت، موجودی) همچنان در ماژول انبار
 * مدیریت می‌شود؛ این کنترلر فقط فیلدهای مخصوص نمای عمومی را می‌نویسد.
 */
@Controller('online-store/products')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('online-store')
export class StoreProductsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'online-store');
    const products = await ctx.tenantDb.product.findMany({
      where: { isActive: true },
      include: { movements: { select: { quantityDelta: true } } },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      salePrice: p.salePrice,
      available: currentStock(p.movements) - p.reservedQty,
      reservedQty: p.reservedQty,
      isPubliclyListed: p.isPubliclyListed,
      publicSlug: p.publicSlug,
      publicDescription: p.publicDescription,
      publicImages: p.publicImages,
    }));
  }

  @Put(':id/listing')
  async updateListing(@Param('id') id: string, @Body() dto: UpdateListingDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'online-store');
    const product = await ctx.tenantDb.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('کالا یافت نشد');

    if (dto.publicSlug) {
      const existing = await ctx.tenantDb.product.findUnique({ where: { publicSlug: dto.publicSlug } });
      if (existing && existing.id !== id) throw new BadRequestException('این شناسه‌ی عمومی قبلاً برای کالای دیگری استفاده شده');
    }
    if (dto.isPubliclyListed && !dto.publicSlug && !product.publicSlug) {
      throw new BadRequestException('برای نمایش عمومی، کالا باید یک شناسه‌ی عمومی (publicSlug) داشته باشد');
    }

    return ctx.tenantDb.product.update({
      where: { id },
      data: {
        isPubliclyListed: dto.isPubliclyListed,
        publicSlug: dto.publicSlug,
        publicDescription: dto.publicDescription,
        publicImages: dto.publicImages,
      },
    });
  }
}
