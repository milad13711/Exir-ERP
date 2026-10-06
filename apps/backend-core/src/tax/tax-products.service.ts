import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { normalizeSearchTerm } from '../common/search.js';
import { PATTERNS } from './mapping/moodian-field-map.js';
import { TaxAuditService } from './tax-audit.service.js';
import type { UpsertTaxProductCodeDto } from './dto/tax.dto.js';

/** نگاشت کالای انبار → شناسه کالا/خدمت. جدول قابل ویرایش (نه ثابت کد) تا نرخ و کد با مقررات جدید عوض شود. */
@Injectable()
export class TaxProductsService {
  constructor(private readonly audit: TaxAuditService) {}

  /** فهرست محصولات (فقط فعال‌ها) همراه نگاشت؛ جستجوی ajax سمت سرور با q. */
  async list(ctx: TenantRequestContext, q?: string, onlyUnmapped = false) {
    const term = normalizeSearchTerm(q);
    const rows = await ctx.tenantDb.product.findMany({
      where: {
        isActive: true,
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }] } : {}),
        ...(onlyUnmapped ? { taxCode: null } : {}),
      },
      select: { id: true, sku: true, name: true, unit: true, taxCode: { select: { sstid: true, unitCode: true, vatRate: true, updatedAt: true } } },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return rows;
  }

  async upsert(ctx: TenantRequestContext, dto: UpsertTaxProductCodeDto) {
    if (!PATTERNS.sstid.test(dto.sstid)) throw new BadRequestException('شناسه کالا/خدمت باید ۱۳ رقم باشد');
    const product = await ctx.tenantDb.product.findUnique({ where: { id: dto.productId }, select: { id: true } });
    if (!product) throw new NotFoundException('کالا یافت نشد');
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const row = await ctx.tenantDb.taxProductCode.upsert({
      where: { productId: dto.productId },
      create: { productId: dto.productId, sstid: dto.sstid, unitCode: dto.unitCode, vatRate: dto.vatRate ?? null, createdByUserId: userId ?? undefined },
      update: { sstid: dto.sstid, unitCode: dto.unitCode, vatRate: dto.vatRate ?? null },
    });
    await this.audit.activity(ctx, 'tax.productCode.upserted', row.id, { productId: dto.productId, sstid: dto.sstid }, 'TaxProductCode');
    return row;
  }

  async remove(ctx: TenantRequestContext, productId: string) {
    const res = await ctx.tenantDb.taxProductCode.deleteMany({ where: { productId } });
    if (res.count === 0) throw new NotFoundException('نگاشتی برای این کالا نیست');
    await this.audit.activity(ctx, 'tax.productCode.removed', productId, { productId }, 'TaxProductCode');
    return { success: true };
  }
}
