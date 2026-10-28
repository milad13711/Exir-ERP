import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateBomDto } from './dto/create-bom.dto.js';
import { UpdateBomDto } from './dto/update-bom.dto.js';
import { bomContentChanged, findBomCycle, validateBomLines } from './bom-rules.js';

const BOM_INCLUDE = {
  outputProduct: { select: { id: true, name: true, unit: true, sku: true } },
  lines: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
  _count: { select: { productionOrders: true } },
};

function withUsage<T extends { _count?: { productionOrders: number } }>(bom: T) {
  const { _count, ...rest } = bom;
  return { ...rest, usageCount: _count?.productionOrders ?? 0 };
}

@Controller('production/boms')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class BomsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** status=active (پیش‌فرض: همان چیزی که در انتخاب‌گرها می‌آید) | archived (بایگانی دستی) | history (نسخه‌های جایگزین‌شده) | all */
  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    const where =
      status === 'archived'
        ? { isActive: false, archivedAt: { not: null } }
        : status === 'history'
          ? { isActive: false, archivedAt: null }
          : status === 'all'
            ? {}
            : { isActive: true };
    const boms = await ctx.tenantDb.billOfMaterial.findMany({ where, include: BOM_INCLUDE, orderBy: { createdAt: 'desc' } });
    return boms.map(withUsage);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    const bom = await ctx.tenantDb.billOfMaterial.findUnique({ where: { id }, include: BOM_INCLUDE });
    if (!bom) throw new NotFoundException('فرمول تولید یافت نشد');
    return withUsage(bom);
  }

  /** مواد اولیه‌ی فرمول‌های فعال، برای تشخیص وابستگی چرخه‌ای نیمه‌ساخته‌ها (به‌جز فرمول در حال ویرایش). */
  private async activeComponentMap(ctx: TenantRequestContext, excludeBomId?: string) {
    const active = await ctx.tenantDb.billOfMaterial.findMany({
      where: { isActive: true, ...(excludeBomId ? { id: { not: excludeBomId } } : {}) },
      select: { outputProductId: true, lines: { select: { rawMaterialProductId: true } } },
    });
    const map = new Map<string, string[]>();
    for (const b of active) map.set(b.outputProductId, b.lines.map((l) => l.rawMaterialProductId));
    return map;
  }

  private async assertNoCycle(ctx: TenantRequestContext, outputProductId: string, componentIds: string[], excludeBomId?: string) {
    const cycle = findBomCycle(outputProductId, componentIds, await this.activeComponentMap(ctx, excludeBomId));
    if (cycle) {
      const products = await ctx.tenantDb.product.findMany({ where: { id: { in: cycle } }, select: { id: true, name: true } });
      const names = new Map(products.map((p) => [p.id, p.name]));
      throw new BadRequestException(`فرمول وابستگی چرخه‌ای دارد: ${cycle.map((c) => names.get(c) ?? '؟').join(' ← ')}`);
    }
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
    const invalid = validateBomLines(dto.outputProductId, dto.batchOutputQty, dto.lines);
    if (invalid) throw new BadRequestException(invalid);
    await this.assertNoCycle(ctx, dto.outputProductId, dto.lines.map((l) => l.rawMaterialProductId));

    const previousActive = await ctx.tenantDb.billOfMaterial.findFirst({
      where: { outputProductId: dto.outputProductId, isActive: true },
      orderBy: { version: 'desc' },
    });

    const latestAny = await ctx.tenantDb.billOfMaterial.findFirst({
      where: { outputProductId: dto.outputProductId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const userId = await resolveTenantUserId(ctx);
    const [bom] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.billOfMaterial.create({
        data: {
          outputProductId: dto.outputProductId,
          batchOutputQty: dto.batchOutputQty,
          notes: dto.notes?.trim() || null,
          version: Math.max(previousActive?.version ?? 0, latestAny?.version ?? 0) + 1,
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

  /**
   * ویرایش فرمول. اگر فرمول در هیچ دستور تولیدی استفاده نشده، درجا ویرایش می‌شود. اگر در دستورهای تولید (حتی
   * تکمیل‌شده) استفاده شده، فرمول قدیمی دست‌نخورده می‌ماند (تاریخچه و بهای تمام‌شده‌ی دستورهای قبلی ثابت)
   * و یک «نسخه‌ی جدید» ساخته می‌شود که جایگزین فعال می‌شود. ویرایش فقط توضیحات، همیشه درجاست.
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateBomDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const bom = await ctx.tenantDb.billOfMaterial.findUnique({ where: { id }, include: BOM_INCLUDE });
    if (!bom) throw new NotFoundException('فرمول تولید یافت نشد');
    if (!bom.isActive) {
      throw new BadRequestException(
        bom.archivedAt
          ? 'این فرمول بایگانی شده است؛ ابتدا آن را بازیابی کنید'
          : 'این نسخه با نسخه‌ی جدیدتری جایگزین شده و فقط برای تاریخچه نگه‌داری می‌شود؛ نسخه‌ی فعال را ویرایش کنید',
      );
    }

    const current = { batchOutputQty: bom.batchOutputQty, lines: bom.lines.map((l) => ({ rawMaterialProductId: l.rawMaterialProductId, quantityPerBatch: l.quantityPerBatch })) };
    const next = {
      batchOutputQty: dto.batchOutputQty ?? current.batchOutputQty,
      lines: dto.lines ?? current.lines,
    };
    const invalid = validateBomLines(bom.outputProductId, next.batchOutputQty, next.lines);
    if (invalid) throw new BadRequestException(invalid);

    const notes = dto.notes === undefined ? bom.notes : dto.notes.trim() || null;
    const changed = bomContentChanged(current, next);

    if (!changed) {
      if (notes === bom.notes) return withUsage(bom);
      const updated = await ctx.tenantDb.billOfMaterial.update({ where: { id }, data: { notes }, include: BOM_INCLUDE });
      return withUsage(updated);
    }

    const ids = next.lines.map((l) => l.rawMaterialProductId);
    const found = await ctx.tenantDb.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== new Set(ids).size) throw new NotFoundException('یکی از مواد اولیه یافت نشد');
    await this.assertNoCycle(ctx, bom.outputProductId, ids, id);

    const usage = bom._count?.productionOrders ?? 0;
    if (usage === 0) {
      const [, updated] = await ctx.tenantDb.$transaction([
        ctx.tenantDb.billOfMaterialLine.deleteMany({ where: { bomId: id } }),
        ctx.tenantDb.billOfMaterial.update({
          where: { id },
          data: { batchOutputQty: next.batchOutputQty, notes, lines: { create: next.lines.map((l) => ({ rawMaterialProductId: l.rawMaterialProductId, quantityPerBatch: l.quantityPerBatch })) } },
          include: BOM_INCLUDE,
        }),
      ]);
      return { ...withUsage(updated), versioned: false };
    }

    // copy-on-edit: نسخه‌ی قدیمی با دستورهای تولیدش دست‌نخورده می‌ماند
    const latest = await ctx.tenantDb.billOfMaterial.findFirst({ where: { outputProductId: bom.outputProductId }, orderBy: { version: 'desc' }, select: { version: true } });
    const userId = await resolveTenantUserId(ctx);
    const [created] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.billOfMaterial.create({
        data: {
          outputProductId: bom.outputProductId,
          batchOutputQty: next.batchOutputQty,
          version: (latest?.version ?? bom.version) + 1,
          notes,
          createdByUserId: userId,
          lines: { create: next.lines.map((l) => ({ rawMaterialProductId: l.rawMaterialProductId, quantityPerBatch: l.quantityPerBatch })) },
        },
        include: BOM_INCLUDE,
      }),
      ctx.tenantDb.billOfMaterial.update({ where: { id }, data: { isActive: false } }),
    ]);
    return { ...withUsage(created), versioned: true, previousVersionId: id };
  }

  /** بایگانی: از انتخاب‌گرها پنهان می‌شود ولی در تاریخچه و دستورهای قبلی می‌ماند. */
  @Post(':id/archive')
  async archive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const bom = await ctx.tenantDb.billOfMaterial.findUnique({ where: { id } });
    if (!bom) throw new NotFoundException('فرمول تولید یافت نشد');
    if (!bom.isActive) throw new BadRequestException('این فرمول فعال نیست');
    const updated = await ctx.tenantDb.billOfMaterial.update({ where: { id }, data: { isActive: false, archivedAt: new Date() }, include: BOM_INCLUDE });
    return withUsage(updated);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const bom = await ctx.tenantDb.billOfMaterial.findUnique({ where: { id }, include: { lines: true } });
    if (!bom) throw new NotFoundException('فرمول تولید یافت نشد');
    if (!bom.archivedAt) throw new BadRequestException('فقط فرمول بایگانی‌شده قابل بازیابی است');
    const other = await ctx.tenantDb.billOfMaterial.findFirst({ where: { outputProductId: bom.outputProductId, isActive: true } });
    if (other) throw new ConflictException('برای این محصول فرمول فعال دیگری وجود دارد؛ ابتدا آن را بایگانی کنید');
    await this.assertNoCycle(ctx, bom.outputProductId, bom.lines.map((l) => l.rawMaterialProductId), id);
    const updated = await ctx.tenantDb.billOfMaterial.update({ where: { id }, data: { isActive: true, archivedAt: null }, include: BOM_INCLUDE });
    return withUsage(updated);
  }

  /** حذف قطعی فقط برای فرمولی که در هیچ دستور تولیدی نیامده؛ وگرنه فقط بایگانی. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'production');
    const bom = await ctx.tenantDb.billOfMaterial.findUnique({ where: { id }, include: { _count: { select: { productionOrders: true } } } });
    if (!bom) throw new NotFoundException('فرمول تولید یافت نشد');
    const usage = bom._count?.productionOrders ?? 0;
    if (usage > 0) {
      throw new ConflictException(
        `این فرمول در ${usage} دستور تولید استفاده شده و حذف نمی‌شود تا تاریخچه و بهای تمام‌شده‌ی آن‌ها حفظ شود. به‌جای حذف می‌توانید آن را بایگانی کنید.`,
      );
    }
    await ctx.tenantDb.billOfMaterial.delete({ where: { id } });
    return { success: true };
  }
}
