import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { currentStock } from './stock.js';

@Controller('warehouse/summary')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class WarehouseSummaryController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async summary(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warehouse');
    const products = await ctx.tenantDb.product.findMany({
      include: { movements: { select: { quantityDelta: true } } },
    });

    let inventoryValue = 0;
    let lowStockCount = 0;
    for (const { movements, ...product } of products) {
      const stock = currentStock(movements);
      inventoryValue += stock * product.costPrice;
      if (product.reorderPoint > 0 && stock <= product.reorderPoint) lowStockCount += 1;
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const movementsThisMonth = await ctx.tenantDb.stockMovement.count({
      where: { createdAt: { gte: monthStart } },
    });

    return {
      totalProducts: products.length,
      lowStockCount,
      inventoryValue,
      movementsThisMonth,
    };
  }
}
