import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { currentStock } from '../warehouse/stock.js';
import { CreateProductionOrderDto } from './dto/create-production-order.dto.js';
import { ApproveRawMaterialDto } from './dto/approve-raw-material.dto.js';
import { UpdateStageDto } from './dto/update-stage.dto.js';
import { CompleteOrderDto } from './dto/complete-order.dto.js';
import { RejectOrderDto } from './dto/reject-order.dto.js';
import { scaleRequirement } from './production-capacity.js';

const ORDER_INCLUDE = {
  bom: { include: { outputProduct: true, lines: { include: { rawMaterial: true } } } },
  warehouse: true,
  stages: { include: { workCenter: true, assignedUser: { select: { id: true, name: true } } }, orderBy: { sequenceOrder: 'asc' as const } },
};

@Controller('production/orders')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class ProductionOrdersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    return ctx.tenantDb.productionOrder.findMany({
      where: status ? { status: status as never } : undefined,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');
    return order;
  }

  @Post()
  async create(@Body() dto: CreateProductionOrderDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'production');

    const [bom, warehouse] = await Promise.all([
      ctx.tenantDb.billOfMaterial.findUnique({ where: { id: dto.bomId }, include: { lines: true } }),
      ctx.tenantDb.warehouse.findUnique({ where: { id: dto.warehouseId } }),
    ]);
    if (!bom || !bom.isActive) throw new NotFoundException('فرمول تولید یافت نشد یا غیرفعال است');
    if (!warehouse) throw new NotFoundException('انبار یافت نشد');

    if (dto.stages) {
      const workCenters = await ctx.tenantDb.workCenter.findMany({
        where: { id: { in: dto.stages.map((s) => s.workCenterId) } },
      });
      if (workCenters.length !== new Set(dto.stages.map((s) => s.workCenterId)).size) {
        throw new NotFoundException('یکی از ایستگاه‌های تولید یافت نشد');
      }
    }

    const userId = await resolveTenantUserId(ctx);
    const order = await ctx.tenantDb.productionOrder.create({
      data: {
        bomId: dto.bomId,
        warehouseId: dto.warehouseId,
        quantityPlanned: dto.quantityPlanned,
        relatedInvoiceId: dto.relatedInvoiceId,
        plannedStartAt: dto.plannedStartAt ? new Date(dto.plannedStartAt) : undefined,
        plannedEndAt: dto.plannedEndAt ? new Date(dto.plannedEndAt) : undefined,
        createdByUserId: userId,
        stages: dto.stages
          ? {
              create: dto.stages.map((s, i) => ({
                workCenterId: s.workCenterId,
                assignedUserId: s.assignedUserId,
                sequenceOrder: i,
              })),
            }
          : undefined,
      },
      include: ORDER_INCLUDE,
    });
    return order;
  }

  /**
   * The gate before any warehouse movement happens: a supervisor confirms
   * the raw materials on hand are actually fit for use. Only after this do
   * we check stock sufficiency and deduct it — checking earlier would let
   * someone "reserve" stock for an order nobody has actually inspected yet.
   */
  @Post(':id/approve-raw-materials')
  async approveRawMaterials(@Param('id') id: string, @Body() dto: ApproveRawMaterialDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const order = await ctx.tenantDb.productionOrder.findUnique({
      where: { id },
      include: { bom: { include: { lines: { include: { rawMaterial: true } } } } },
    });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');
    if (order.status !== 'DRAFT') throw new BadRequestException('این دستور تولید در وضعیت پیش‌نویس نیست');

    const requirements = order.bom.lines.map((line) => ({
      line,
      required: scaleRequirement(order.bom.batchOutputQty, line.quantityPerBatch, order.quantityPlanned),
    }));

    const stocks = await Promise.all(
      requirements.map((r) =>
        ctx.tenantDb.stockMovement
          .findMany({ where: { productId: r.line.rawMaterialProductId, warehouseId: order.warehouseId }, select: { quantityDelta: true } })
          .then(currentStock),
      ),
    );

    const shortages = requirements
      .map((r, i) => ({ ...r, available: stocks[i] }))
      .filter((r) => r.available < r.required);

    if (shortages.length > 0) {
      const list = shortages
        .map((s) => `${s.line.rawMaterial.name} (نیاز: ${s.required}${s.line.rawMaterial.unit}، موجود: ${s.available}${s.line.rawMaterial.unit})`)
        .join('، ');
      throw new BadRequestException(`موجودی مواد اولیه کافی نیست: ${list}`);
    }

    const userId = await resolveTenantUserId(ctx);
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.productionOrder.update({
        where: { id },
        data: {
          status: 'RAW_MATERIAL_APPROVED',
          rawMaterialApprovedByUserId: userId,
          rawMaterialApprovedAt: new Date(),
          rawMaterialApprovalNotes: dto.notes,
        },
      }),
      ...requirements.map((r) =>
        ctx.tenantDb.stockMovement.create({
          data: {
            productId: r.line.rawMaterialProductId,
            warehouseId: order.warehouseId,
            type: 'PRODUCTION_CONSUME',
            quantityDelta: -r.required,
            reference: `دستور تولید #${order.orderNo}`,
            createdByUserId: userId,
          },
        }),
      ),
    ]);

    return ctx.tenantDb.productionOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');
    if (order.status !== 'RAW_MATERIAL_APPROVED') {
      throw new BadRequestException('ابتدا باید مواد اولیه تأیید شود');
    }
    return ctx.tenantDb.productionOrder.update({
      where: { id },
      data: { status: 'IN_PROGRESS', actualStartAt: new Date() },
      include: ORDER_INCLUDE,
    });
  }

  @Post(':id/stages/:stageId')
  async updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: UpdateStageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'production');
    const stage = await ctx.tenantDb.productionOrderStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.productionOrderId !== id) throw new NotFoundException('مرحله‌ی تولید یافت نشد');

    return ctx.tenantDb.productionOrderStage.update({
      where: { id: stageId },
      data: {
        status: dto.status,
        report: dto.report,
        assignedUserId: dto.assignedUserId,
        startedAt: dto.status === 'IN_PROGRESS' && !stage.startedAt ? new Date() : undefined,
        endedAt: dto.status === 'DONE' && !stage.endedAt ? new Date() : undefined,
      },
      include: { workCenter: true, assignedUser: { select: { id: true, name: true } } },
    });
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() dto: CompleteOrderDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id }, include: { bom: true } });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');
    if (order.status !== 'IN_PROGRESS') throw new BadRequestException('این دستور تولید در حال انجام نیست');

    const quantityProduced = dto.quantityProduced ?? order.quantityPlanned;
    const userId = await resolveTenantUserId(ctx);

    await ctx.tenantDb.$transaction([
      ctx.tenantDb.productionOrder.update({
        where: { id },
        data: { status: 'COMPLETED', actualEndAt: new Date(), quantityProduced },
      }),
      ctx.tenantDb.stockMovement.create({
        data: {
          productId: order.bom.outputProductId,
          warehouseId: order.warehouseId,
          type: 'PRODUCTION_YIELD',
          quantityDelta: quantityProduced,
          reference: `دستور تولید #${order.orderNo}`,
          createdByUserId: userId,
        },
      }),
    ]);

    return ctx.tenantDb.productionOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectOrderDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED' || order.status === 'REJECTED') {
      throw new BadRequestException('این دستور تولید دیگر قابل رد کردن نیست');
    }
    return ctx.tenantDb.productionOrder.update({
      where: { id },
      data: { status: 'REJECTED', rawMaterialApprovalNotes: dto.reason },
      include: ORDER_INCLUDE,
    });
  }
}
