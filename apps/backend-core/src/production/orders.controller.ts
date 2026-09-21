import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { currentStock } from '../warehouse/stock.js';
import { CreateProductionOrderDto } from './dto/create-production-order.dto.js';
import { ApproveRawMaterialDto } from './dto/approve-raw-material.dto.js';
import { UpdateStageDto } from './dto/update-stage.dto.js';
import { CompleteOrderDto } from './dto/complete-order.dto.js';
import { RejectOrderDto } from './dto/reject-order.dto.js';
import { scaleRequirement } from './production-capacity.js';
import { decideCompletion } from './completion-flow.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { orderCreatedPayload } from './production-automation.triggers.js';

const ORDER_INCLUDE = {
  bom: { include: { outputProduct: true, lines: { include: { rawMaterial: true } } } },
  warehouse: true,
  stages: { include: { workCenter: true, assignedUser: { select: { id: true, name: true } } }, orderBy: { sequenceOrder: 'asc' as const } },
};

@Controller('production/orders')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class ProductionOrdersController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
    private readonly automation: AutomationEngineService,
  ) {}

  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'production');
    return ctx.tenantDb.productionOrder.findMany({
      where: status ? { status: status as never } : undefined,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'production');
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
    await this.automation.emit(ctx, 'production.order.created', orderCreatedPayload(order));
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
    const stage = await ctx.tenantDb.productionOrderStage.findUnique({
      where: { id: stageId },
      include: { workCenter: true },
    });
    if (!stage || stage.productionOrderId !== id) throw new NotFoundException('مرحله‌ی تولید یافت نشد');

    const updated = await ctx.tenantDb.productionOrderStage.update({
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

    if (dto.status === 'DONE' && stage.status !== 'DONE') {
      const nextStage = await ctx.tenantDb.productionOrderStage.findFirst({
        where: { productionOrderId: id, sequenceOrder: { gt: stage.sequenceOrder } },
        orderBy: { sequenceOrder: 'asc' },
        include: { workCenter: true },
      });
      if (nextStage) {
        const order = await ctx.tenantDb.productionOrder.findUniqueOrThrow({
          where: { id },
          include: { bom: { include: { outputProduct: true } } },
        });
        await this.automation.emit(ctx, 'production.stage.completed', {
          orderNo: order.orderNo,
          productName: order.bom.outputProduct.name,
          stageName: stage.workCenter.name,
          nextStageName: nextStage.workCenter.name,
          nextStageAssigneeUserId: nextStage.assignedUserId,
        });
      }
    }

    return updated;
  }

  /**
   * Two-step when quality-control is installed: the first call (from
   * IN_PROGRESS) records the actual output quantity and, if no PASS sample
   * from the final product exists yet, parks the order in QC_PENDING rather
   * than finalizing — the physical run is done, but nothing is released to
   * stock until QC signs off. A second call (once a PASS sample exists)
   * finalizes it. Without quality-control installed, one call does both.
   */
  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() dto: CompleteOrderDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id }, include: { bom: true } });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');

    const qcInstalled = Boolean(
      await this.controlDb.tenantModule.findFirst({
        where: { tenantId: ctx.tenantId, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'quality-control' } },
      }),
    );
    const passedSample = qcInstalled
      ? await ctx.tenantDb.qualitySample.findFirst({
          where: { productionOrderId: id, source: 'FINAL_PRODUCT', verdict: 'PASS' },
        })
      : null;

    const outcome = decideCompletion(order.status, qcInstalled, Boolean(passedSample));

    if (outcome.action === 'INVALID_STATUS') {
      throw new BadRequestException('این دستور تولید در حال انجام یا در انتظار کنترل کیفیت نیست');
    }
    if (outcome.action === 'STILL_AWAITING_QC') {
      throw new BadRequestException(
        'برای تکمیل این دستور تولید، ابتدا باید یک نمونه از محصول نهایی با نتیجه‌ی «قبول» در ماژول کنترل کیفیت ثبت شود',
      );
    }
    if (outcome.action === 'AWAIT_QC') {
      const quantityProduced = dto.quantityProduced ?? order.quantityPlanned;
      return ctx.tenantDb.productionOrder.update({
        where: { id },
        data: { status: 'QC_PENDING', actualEndAt: new Date(), quantityProduced },
        include: ORDER_INCLUDE,
      });
    }

    // FINALIZE — either no QC gate, or the gate already passed.
    const quantityProduced = order.status === 'QC_PENDING' ? (order.quantityProduced ?? order.quantityPlanned) : (dto.quantityProduced ?? order.quantityPlanned);
    const userId = await resolveTenantUserId(ctx);

    await ctx.tenantDb.$transaction([
      ctx.tenantDb.productionOrder.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          actualEndAt: order.actualEndAt ?? new Date(),
          quantityProduced,
          qualityApprovedAt: qcInstalled ? new Date() : undefined,
        },
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

  /**
   * DRAFT has no raw-material stock committed yet, so stopping it there is a
   * plain cancellation. Past that point materials were already deducted
   * (approve-raw-materials) or the run may already be mid-progress, so
   * stopping it means the batch is a loss — recorded as REJECTED, not
   * reversed, since the material really was consumed.
   */
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
      data: { status: order.status === 'DRAFT' ? 'CANCELLED' : 'REJECTED', rawMaterialApprovalNotes: dto.reason },
      include: ORDER_INCLUDE,
    });
  }
}
