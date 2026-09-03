import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateSampleDto } from './dto/create-sample.dto.js';
import { AddResultDto } from './dto/add-result.dto.js';

const SAMPLE_INCLUDE = {
  results: { include: { testType: true, testedBy: { select: { id: true, name: true } } } },
  sampledBy: { select: { id: true, name: true } },
  productionOrderStage: { include: { workCenter: true } },
  productionOrder: { select: { orderNo: true, bom: { select: { outputProduct: { select: { name: true } } } } } },
};

@Controller('quality-control/samples')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('quality-control')
export class QualitySamplesController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@Query('productionOrderId') productionOrderId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'quality-control');
    return ctx.tenantDb.qualitySample.findMany({
      where: productionOrderId ? { productionOrderId } : undefined,
      include: SAMPLE_INCLUDE,
      orderBy: { sampledAt: 'desc' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'quality-control');
    const sample = await ctx.tenantDb.qualitySample.findUnique({ where: { id }, include: SAMPLE_INCLUDE });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    return sample;
  }

  @Post()
  async create(@Body() dto: CreateSampleDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'quality-control');
    const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id: dto.productionOrderId } });
    if (!order) throw new NotFoundException('دستور تولید یافت نشد');

    const userId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.qualitySample.create({
      data: {
        productionOrderId: dto.productionOrderId,
        productionOrderStageId: dto.productionOrderStageId,
        source: dto.source,
        note: dto.note,
        sampledByUserId: userId,
      },
      include: SAMPLE_INCLUDE,
    });
  }

  /**
   * Adds one test result — the sample's own verdict is recomputed from ALL
   * its results (any FAIL makes the sample FAIL). A fresh FAIL escalates
   * immediately: notifies whoever created the production order and opens a
   * follow-up task, reusing the same Task/Notification infrastructure every
   * other module already uses rather than a bespoke alerting path.
   */
  @Post(':id/results')
  async addResult(@Param('id') id: string, @Body() dto: AddResultDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'quality-control');
    const [sample, testType] = await Promise.all([
      ctx.tenantDb.qualitySample.findUnique({ where: { id }, include: { productionOrder: { include: { bom: { include: { outputProduct: true } } } } } }),
      ctx.tenantDb.qualityTestType.findUnique({ where: { id: dto.testTypeId } }),
    ]);
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    if (!testType) throw new NotFoundException('نوع آزمون یافت نشد');

    const min = testType.acceptableMin != null ? Number(testType.acceptableMin) : null;
    const max = testType.acceptableMax != null ? Number(testType.acceptableMax) : null;
    const resultVerdict = (min != null && dto.measuredValue < min) || (max != null && dto.measuredValue > max) ? 'FAIL' : 'PASS';

    const userId = await resolveTenantUserId(ctx);
    await ctx.tenantDb.qualitySampleResult.create({
      data: {
        sampleId: id,
        testTypeId: dto.testTypeId,
        measuredValue: dto.measuredValue,
        verdict: resultVerdict,
        testedByUserId: userId,
      },
    });

    const allResults = await ctx.tenantDb.qualitySampleResult.findMany({ where: { sampleId: id } });
    const sampleVerdict = allResults.some((r) => r.verdict === 'FAIL') ? 'FAIL' : 'PASS';
    await ctx.tenantDb.qualitySample.update({ where: { id }, data: { verdict: sampleVerdict } });

    if (resultVerdict === 'FAIL' && sample.productionOrder.createdByUserId) {
      const productName = sample.productionOrder.bom.outputProduct.name;
      await ctx.tenantDb.task.create({
        data: {
          title: `نمونه آزمایشگاهی رد شد — ${productName} (دستور تولید #${sample.productionOrder.orderNo})`,
          assignedUserId: sample.productionOrder.createdByUserId,
          relatedModule: 'quality-control',
          relatedEntityId: id,
          priority: 'URGENT',
        },
      });
      await this.notifications.notify(ctx.tenantDb, {
        userId: sample.productionOrder.createdByUserId,
        type: 'quality.sample.failed',
        title: `نتیجه‌ی آزمون «${testType.name}» رد شد`,
        body: `${productName} — دستور تولید #${sample.productionOrder.orderNo} — مقدار اندازه‌گیری‌شده: ${dto.measuredValue}${testType.unit}`,
        link: '/production',
      });
    }

    return ctx.tenantDb.qualitySample.findUnique({ where: { id }, include: SAMPLE_INCLUDE });
  }
}
