import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';
import { ensureFixedAssetAccounts, computeDepreciation, FIXED_ASSET_ACCOUNT } from './fixed-assets.js';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto.js';
import { DisposeFixedAssetDto } from './dto/dispose-fixed-asset.dto.js';

@Controller('accounting/fixed-assets')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class FixedAssetsController {
  constructor(private readonly permissions: PermissionsService) {}

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد`);
    return account;
  }

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    const assets = await ctx.tenantDb.fixedAsset.findMany({ orderBy: { purchaseDate: 'desc' } });
    return assets.map((a) => ({ ...a, depreciation: computeDepreciation(a) }));
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    const asset = await ctx.tenantDb.fixedAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('دارایی ثابت یافت نشد');
    return { ...asset, depreciation: computeDepreciation(asset) };
  }

  @Post()
  async create(@Body() dto: CreateFixedAssetDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    await ensureFixedAssetAccounts(ctx.tenantDb);
    const userId = await resolveTenantUserId(ctx);
    const asset = await ctx.tenantDb.fixedAsset.create({
      data: {
        name: dto.name,
        category: dto.category,
        purchaseDate: new Date(dto.purchaseDate),
        purchaseCost: dto.purchaseCost,
        salvageValue: dto.salvageValue ?? 0,
        usefulLifeMonths: dto.usefulLifeMonths,
        notes: dto.notes,
        createdByUserId: userId,
      },
    });
    return { ...asset, depreciation: computeDepreciation(asset) };
  }

  /**
   * تفاوت استهلاک محاسبه‌شده تا امروز و استهلاکی که قبلاً سندش ثبت شده را
   * به‌عنوان یک سند حسابداری تازه ثبت می‌کند (Dr هزینه استهلاک / Cr استهلاک
   * انباشته) — فراخوانی مکرر امن است، چون فقط روی «افزایش» جدید سند می‌زند.
   */
  @Post(':id/post-depreciation')
  async postDepreciation(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    await ensureFixedAssetAccounts(ctx.tenantDb);
    const asset = await ctx.tenantDb.fixedAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('دارایی ثابت یافت نشد');

    const { accumulatedDepreciation } = computeDepreciation(asset);
    const delta = accumulatedDepreciation - asset.postedDepreciation;
    if (delta <= 0) return { posted: 0 };

    const userId = await resolveTenantUserId(ctx);
    const expense = await this.getAccount(ctx, FIXED_ASSET_ACCOUNT.DEPRECIATION_EXPENSE);
    const accumulated = await this.getAccount(ctx, FIXED_ASSET_ACCOUNT.ACCUMULATED_DEPRECIATION);

    await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `استهلاک دارایی «${asset.name}»`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: expense.id, debit: BigInt(delta), credit: BigInt(0) },
              { accountId: accumulated.id, debit: BigInt(0), credit: BigInt(delta) },
            ],
          },
        },
      }),
      ctx.tenantDb.fixedAsset.update({ where: { id }, data: { postedDepreciation: accumulatedDepreciation } }),
    ]);

    return { posted: delta };
  }

  @Post(':id/dispose')
  async dispose(@Param('id') id: string, @Body() dto: DisposeFixedAssetDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const asset = await ctx.tenantDb.fixedAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('دارایی ثابت یافت نشد');
    if (asset.status === 'DISPOSED') throw new BadRequestException('این دارایی قبلاً واگذار شده است');
    const updated = await ctx.tenantDb.fixedAsset.update({
      where: { id },
      data: {
        status: 'DISPOSED',
        disposedAt: dto.disposedAt ? new Date(dto.disposedAt) : new Date(),
        disposalAmount: dto.disposalAmount ?? 0,
      },
    });
    return { ...updated, depreciation: computeDepreciation(updated) };
  }
}
