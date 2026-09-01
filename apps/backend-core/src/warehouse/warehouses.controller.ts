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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ensureDefaultWarehouse } from './default-warehouse.js';
import { currentStock } from './stock.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';

@Controller('warehouse/warehouses')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class WarehousesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warehouse');
    await ensureDefaultWarehouse(ctx.tenantDb);
    const warehouses = await ctx.tenantDb.warehouse.findMany({
      include: { movements: { select: { quantityDelta: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return warehouses.map(({ movements, ...w }) => ({ ...w, stockOnHand: currentStock(movements) }));
  }

  @Post()
  async create(@Body() dto: CreateWarehouseDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    if (dto.code) {
      const existing = await ctx.tenantDb.warehouse.findUnique({ where: { code: dto.code } });
      if (existing) throw new ConflictException('انباری با این کد از قبل وجود دارد');
    }
    return ctx.tenantDb.warehouse.create({ data: dto });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warehouse');
    const existing = await ctx.tenantDb.warehouse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('انبار یافت نشد');
    if (dto.code && dto.code !== existing.code) {
      const codeTaken = await ctx.tenantDb.warehouse.findUnique({ where: { code: dto.code } });
      if (codeTaken) throw new ConflictException('انباری با این کد از قبل وجود دارد');
    }
    return ctx.tenantDb.warehouse.update({ where: { id }, data: dto });
  }

  @Post(':id/set-default')
  async setDefault(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warehouse');
    const existing = await ctx.tenantDb.warehouse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('انبار یافت نشد');
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      ctx.tenantDb.warehouse.update({ where: { id }, data: { isDefault: true, isActive: true } }),
    ]);
    return ctx.tenantDb.warehouse.findUnique({ where: { id } });
  }

  /** Soft-delete only — StockMovement.warehouseId is a required (RESTRICT) FK, so a warehouse with any history can't be hard-deleted. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'warehouse');
    const existing = await ctx.tenantDb.warehouse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('انبار یافت نشد');
    if (existing.isDefault) {
      throw new ConflictException('انبار پیش‌فرض قابل غیرفعال‌سازی نیست — ابتدا انبار دیگری را پیش‌فرض کنید');
    }
    const movementCount = await ctx.tenantDb.stockMovement.count({ where: { warehouseId: id } });
    if (movementCount > 0) {
      await ctx.tenantDb.warehouse.update({ where: { id }, data: { isActive: false } });
      return { success: true, softDeleted: true };
    }
    await ctx.tenantDb.warehouse.delete({ where: { id } });
    return { success: true, softDeleted: false };
  }
}
