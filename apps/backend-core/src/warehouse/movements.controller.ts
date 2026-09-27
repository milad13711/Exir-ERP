import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { currentStock } from './stock.js';
import { CostingService } from './costing.service.js';

const MOVEMENT_LABELS_FA: Record<string, string> = {
  RECEIPT: 'رسید ورودی',
  ISSUE: 'حواله خروجی',
  ADJUSTMENT: 'اصلاح موجودی',
};

@Controller('warehouse/movements')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class MovementsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly permissions: PermissionsService,
    private readonly costing: CostingService,
  ) {}

  @Get()
  async list(
    @Query('type') type: string | undefined,
    @Query('productId') productId: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'warehouse');
    return ctx.tenantDb.stockMovement.findMany({
      where: {
        ...(type ? { type: type as never } : {}),
        ...(productId ? { productId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        product: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post()
  async create(@Body() dto: CreateMovementDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    const [product, warehouse] = await Promise.all([
      ctx.tenantDb.product.findUnique({
        where: { id: dto.productId },
        include: { movements: { where: { warehouseId: dto.warehouseId }, select: { quantityDelta: true } } },
      }),
      ctx.tenantDb.warehouse.findUnique({ where: { id: dto.warehouseId } }),
    ]);
    if (!product) throw new NotFoundException('کالا یافت نشد');
    if (!warehouse) throw new NotFoundException('انبار یافت نشد');

    if (dto.type !== 'ADJUSTMENT' && dto.quantity <= 0) {
      throw new BadRequestException('مقدار باید بزرگ‌تر از صفر باشد');
    }
    if (dto.type === 'ADJUSTMENT' && dto.quantity === 0) {
      throw new BadRequestException('مقدار اصلاح نمی‌تواند صفر باشد');
    }

    const quantityDelta =
      dto.type === 'RECEIPT' ? dto.quantity : dto.type === 'ISSUE' ? -dto.quantity : dto.quantity;

    const stockBefore = currentStock(product.movements);
    if (stockBefore + quantityDelta < 0) {
      throw new BadRequestException(
        `موجودی این کالا در انبار «${warehouse.name}» کافی نیست — موجودی فعلی ${stockBefore} ${product.unit} است`,
      );
    }

    const userId = await resolveTenantUserId(ctx);
    const nextCostPrice =
      dto.type === 'RECEIPT' && dto.unitCost != null
        ? await this.costing.nextCostPriceOnReceipt(ctx, dto.productId, dto.quantity, dto.unitCost)
        : null;
    // این کالا درصد سود دارد و MANUAL نشده و تنظیم سراسری فعال است → قیمت
    // فروش هم همراه بهای تمام‌شده‌ی تازه بازمحاسبه می‌شود (ر.ک. CostingService.nextSalePriceOnReceipt).
    const nextSalePrice =
      nextCostPrice != null ? await this.costing.nextSalePriceOnReceipt(ctx, dto.productId, nextCostPrice) : null;
    const [movement] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.stockMovement.create({
        data: {
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          type: dto.type,
          quantityDelta,
          unitCost: dto.unitCost,
          reference: dto.reference,
          note: dto.note,
          createdByUserId: userId,
        },
      }),
      ...(nextCostPrice != null
        ? [
            ctx.tenantDb.product.update({
              where: { id: dto.productId },
              data: {
                costPrice: nextCostPrice,
                ...(nextSalePrice != null ? { salePrice: nextSalePrice, salePriceUpdatedAt: new Date() } : {}),
              },
            }),
          ]
        : []),
    ]);

    await ctx.tenantDb.activityLog.create({
      data: {
        userId,
        action: 'warehouse.movement.created',
        entityType: 'Product',
        entityId: dto.productId,
        metadata: { type: dto.type, quantity: dto.quantity, label: MOVEMENT_LABELS_FA[dto.type] },
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'warehouse.movement.created', {
      productId: dto.productId,
      type: dto.type,
      quantity: dto.quantity,
    });

    return movement;
  }

  @Post('transfer')
  async transfer(@Body() dto: CreateTransferDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('انبار مبدأ و مقصد نمی‌توانند یکسان باشند');
    }
    const [product, fromWarehouse, toWarehouse] = await Promise.all([
      ctx.tenantDb.product.findUnique({
        where: { id: dto.productId },
        include: { movements: { where: { warehouseId: dto.fromWarehouseId }, select: { quantityDelta: true } } },
      }),
      ctx.tenantDb.warehouse.findUnique({ where: { id: dto.fromWarehouseId } }),
      ctx.tenantDb.warehouse.findUnique({ where: { id: dto.toWarehouseId } }),
    ]);
    if (!product) throw new NotFoundException('کالا یافت نشد');
    if (!fromWarehouse) throw new NotFoundException('انبار مبدأ یافت نشد');
    if (!toWarehouse) throw new NotFoundException('انبار مقصد یافت نشد');

    const stockAtSource = currentStock(product.movements);
    if (stockAtSource < dto.quantity) {
      throw new BadRequestException(
        `موجودی این کالا در انبار «${fromWarehouse.name}» کافی نیست — موجودی فعلی ${stockAtSource} ${product.unit} است`,
      );
    }

    const userId = await resolveTenantUserId(ctx);
    const transferGroupId = randomUUID();
    const reference = `انتقال از «${fromWarehouse.name}» به «${toWarehouse.name}»`;

    const [outMovement] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.stockMovement.create({
        data: {
          productId: dto.productId,
          warehouseId: dto.fromWarehouseId,
          type: 'TRANSFER_OUT',
          quantityDelta: -dto.quantity,
          reference,
          note: dto.note,
          transferGroupId,
          createdByUserId: userId,
        },
      }),
      ctx.tenantDb.stockMovement.create({
        data: {
          productId: dto.productId,
          warehouseId: dto.toWarehouseId,
          type: 'TRANSFER_IN',
          quantityDelta: dto.quantity,
          reference,
          note: dto.note,
          transferGroupId,
          createdByUserId: userId,
        },
      }),
    ]);

    await ctx.tenantDb.activityLog.create({
      data: {
        userId,
        action: 'warehouse.transfer.created',
        entityType: 'Product',
        entityId: dto.productId,
        metadata: { fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, quantity: dto.quantity },
      },
    });

    return outMovement;
  }
}
