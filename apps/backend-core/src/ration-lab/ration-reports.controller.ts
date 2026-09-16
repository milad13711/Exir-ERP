import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';

type TrendPoint = {
  label: string;
  date: Date;
  totalHerdMilkYieldLiters: number | null;
  avgMilkYieldPerAnimalLiters: number | null;
  milkFatPercent: number | null;
  milkProteinPercent: number | null;
};

function toNum(v: unknown): number | null {
  return v == null ? null : Number(v);
}

@Controller('ration-lab/reports')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationReportsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** روند یک دامدار: نقطه‌ی شروع (نمونه‌ی اولیه) + هر چک‌این تکمیل‌شده، به ترتیب تاریخ. */
  @Get('sample/:sampleId/trend')
  async sampleTrend(@Param('sampleId') sampleId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'ration-lab');
    const sample = await ctx.tenantDb.rationSample.findUnique({
      where: { id: sampleId },
      include: { followUps: { where: { completedAt: { not: null } }, orderBy: { scheduledAt: 'asc' } } },
    });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');

    const points: TrendPoint[] = [
      {
        label: 'نمونه‌ی اولیه',
        date: sample.collectedAt,
        totalHerdMilkYieldLiters: toNum(sample.totalHerdMilkYieldLiters),
        avgMilkYieldPerAnimalLiters: toNum(sample.avgMilkYieldPerAnimalLiters),
        milkFatPercent: toNum(sample.milkFatPercent),
        milkProteinPercent: toNum(sample.milkProteinPercent),
      },
      ...sample.followUps.map((f) => ({
        label: `${f.dueOffsetDays} روز بعد`,
        date: f.completedAt!,
        totalHerdMilkYieldLiters: toNum(f.totalHerdMilkYieldLiters),
        avgMilkYieldPerAnimalLiters: toNum(f.avgMilkYieldPerAnimalLiters),
        milkFatPercent: toNum(f.milkFatPercent),
        milkProteinPercent: toNum(f.milkProteinPercent),
      })),
    ];
    return points;
  }

  /**
   * روند تجمیعی همه‌ی دامداران: برای هر نمونه‌ای که حداقل یک چک‌این تکمیل‌شده
   * دارد، درصد تغییر «میانگین شیر هر دام» بین نمونه‌ی اولیه و آخرین چک‌این
   * تکمیل‌شده محاسبه می‌شود، سپس میانگین این درصدها روی همه‌ی دامداران.
   */
  @Get('aggregate')
  async aggregate(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'ration-lab');
    const samples = await ctx.tenantDb.rationSample.findMany({
      where: { avgMilkYieldPerAnimalLiters: { not: null } },
      include: { followUps: { where: { completedAt: { not: null } }, orderBy: { scheduledAt: 'desc' }, take: 1 } },
    });

    const perSample: { sampleCode: string; changePercent: number }[] = [];
    for (const sample of samples) {
      const latest = sample.followUps[0];
      const before = toNum(sample.avgMilkYieldPerAnimalLiters);
      const after = latest ? toNum(latest.avgMilkYieldPerAnimalLiters) : null;
      if (before == null || after == null || before === 0) continue;
      perSample.push({ sampleCode: sample.sampleCode, changePercent: ((after - before) / before) * 100 });
    }

    const avgChangePercent =
      perSample.length > 0 ? perSample.reduce((sum, s) => sum + s.changePercent, 0) / perSample.length : null;

    return { sampleCount: samples.length, evaluatedCount: perSample.length, avgChangePercent, perSample };
  }
}
