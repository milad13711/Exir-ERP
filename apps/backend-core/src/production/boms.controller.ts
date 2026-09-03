import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateBomDto } from './dto/create-bom.dto.js';

@Controller('production/boms')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class BomsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    return ctx.tenantDb.billOfMaterial.findMany({
      where: { isActive: true },
      include: {
        outputProduct: { select: { id: true, name: true, unit: true, sku: true } },
        lines: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    const bom = await ctx.tenantDb.billOfMaterial.findUnique({
      where: { id },
      include: {
        outputProduct: { select: { id: true, name: true, unit: true, sku: true } },
        lines: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
    });
    if (!bom) throw new NotFoundException('فرمول تولید یافت نشد');
    return bom;
  }

  /** Creating a BOM for a product that already has an active one deactivates the old one (bumps version). */
  @Post()
  async create(@Body() dto: CreateBomDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'production');

    const [outputProduct, rawMaterials] = await Promise.all([
      ctx.tenantDb.product.findUnique({ where: { id: dto.outputProductId } }),
      ctx.tenantDb.product.findMany({ where: { id: { in: dto.lines.map((l) => l.rawMaterialProductId) } } }),
    ]);
    if (!outputProduct) throw new NotFoundException('محصول نهایی یافت نشد');
    if (rawMaterials.length !== new Set(dto.lines.map((l) => l.rawMaterialProductId)).size) {
      throw new NotFoundException('یکی از مواد اولیه یافت نشد');
    }
    if (dto.lines.some((l) => l.rawMaterialProductId === dto.outputProductId)) {
      throw new BadRequestException('محصول نهایی نمی‌تواند ماده اولیه‌ی فرمول خودش باشد');
    }

    const previousActive = await ctx.tenantDb.billOfMaterial.findFirst({
      where: { outputProductId: dto.outputProductId, isActive: true },
      orderBy: { version: 'desc' },
    });

    const userId = await resolveTenantUserId(ctx);
    const [bom] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.billOfMaterial.create({
        data: {
          outputProductId: dto.outputProductId,
          batchOutputQty: dto.batchOutputQty,
          version: (previousActive?.version ?? 0) + 1,
          createdByUserId: userId,
          lines: {
            create: dto.lines.map((l) => ({
              rawMaterialProductId: l.rawMaterialProductId,
              quantityPerBatch: l.quantityPerBatch,
            })),
          },
        },
        include: { lines: true },
      }),
      ...(previousActive
        ? [ctx.tenantDb.billOfMaterial.update({ where: { id: previousActive.id }, data: { isActive: false } })]
        : []),
    ]);

    return bom;
  }
}
