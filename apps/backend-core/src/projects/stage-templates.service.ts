import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { SaveStageTemplateDto } from './dto/save-stage-template.dto.js';

const TEMPLATE_INCLUDE = { items: { orderBy: { order: 'asc' as const } } } as const;

@Injectable()
export class StageTemplatesService {
  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.projectStageTemplate.findMany({ include: TEMPLATE_INCLUDE, orderBy: { name: 'asc' } });
  }

  create(ctx: TenantRequestContext, dto: SaveStageTemplateDto) {
    return ctx.tenantDb.projectStageTemplate.create({
      data: {
        name: dto.name,
        items: { create: dto.items.map((item, i) => ({ title: item.title, order: i })) },
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: SaveStageTemplateDto) {
    const existing = await ctx.tenantDb.projectStageTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('الگو یافت نشد');
    // ساده‌ترین راه برای همگام‌سازی یک لیست مرتب: آیتم‌های قبلی حذف و دوباره ساخته می‌شوند —
    // پروژه‌های قبلاً از این الگو ساخته‌شده دست‌نخورده می‌مانند چون ProjectStage رکورد مستقل خودش را دارد.
    await ctx.tenantDb.projectStageTemplateItem.deleteMany({ where: { templateId: id } });
    return ctx.tenantDb.projectStageTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        items: { create: dto.items.map((item, i) => ({ title: item.title, order: i })) },
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.projectStageTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('الگو یافت نشد');
    await ctx.tenantDb.projectStageTemplate.delete({ where: { id } });
    return { success: true };
  }
}
