import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { CostingService, refreshProductCost } from './costing.service.js';
import { breaksStockHistory, deltaFor, isActiveMovement, movementAmendBlock } from './movement-rules.js';
import type { EditMovementDto } from './dto/amend-movement.dto.js';

const TYPE_FA: Record<string, string> = { RECEIPT: 'رسید', ISSUE: 'حواله', ADJUSTMENT: 'اصلاح موجودی' };

/**
 * ویرایش و ابطال نرم رسید/حواله‌ی انبار. قواعد خالص در movement-rules.ts؛ این سرویس فقط تراکنش و
 * بازمحاسبه‌ی بهای تمام‌شده را انجام می‌دهد. هر عمل: دلیل الزامی + ردیف تاریخچه در DocumentRevision + لاگ فعالیت.
 */
@Injectable()
export class MovementAmendmentService {
  constructor(private readonly costing: CostingService) {}

  /** جزئیات یک حرکت + اینکه قابل ویرایش/ابطال هست یا نه (علت مسدودی به فارسی) + تاریخچه. */
  async detail(ctx: TenantRequestContext, id: string) {
    const m = await ctx.tenantDb.stockMovement.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, unit: true, sku: true } },
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!m) throw new NotFoundException('رسید/حواله یافت نشد');
    const block = (await this.linkedBlock(ctx, m)) ?? movementAmendBlock(m);
    const revisions = await ctx.tenantDb.documentRevision.findMany({
      where: { entityType: 'stock_movement', entityId: id },
      orderBy: { revisionNo: 'desc' },
      select: { id: true, revisionNo: true, action: true, reason: true, changes: true, userName: true, createdAt: true },
    });
    return { ...m, amendBlock: block, revisions };
  }

  /** بلوک‌هایی که فقط با پرس‌وجو معلوم می‌شوند (بار حمل ثبت‌شده برای این حواله). */
  private async linkedBlock(ctx: TenantRequestContext, m: { id: string }): Promise<string | null> {
    const shipments = await ctx.tenantDb.shipment.count({ where: { sourceStockMovementId: m.id, status: { not: 'CANCELLED' } } });
    return shipments > 0 ? 'برای این حواله بار (حمل) ثبت شده است؛ ابتدا اعلام بار را لغو کنید' : null;
  }

  private async loadHistory(db: TenantRequestContext['tenantDb'], productId: string, warehouseId: string) {
    const rows = await db.stockMovement.findMany({
      where: { productId, warehouseId },
      select: { id: true, createdAt: true, quantityDelta: true, voidedAt: true, reversalOfId: true },
    });
    return rows.filter(isActiveMovement).map(({ id, createdAt, quantityDelta }) => ({ id, createdAt, quantityDelta }));
  }

  private stockMessage(name: string, unit: string, at: Date | null, minAfter: number) {
    const when = at ? ` (از تاریخ ${at.toLocaleDateString('fa-IR')})` : '';
    return `این تغییر موجودی «${name}» را در انبار منفی می‌کند${when} — حداقل موجودی ${minAfter} ${unit}. ابتدا حواله‌ها/فاکتورهای بعدی را اصلاح کنید`;
  }

  async edit(ctx: TenantRequestContext, id: string, dto: EditMovementDto) {
    const m = await ctx.tenantDb.stockMovement.findUnique({ where: { id }, include: { product: true, warehouse: true } });
    if (!m) throw new NotFoundException('رسید/حواله یافت نشد');
    const block = (await this.linkedBlock(ctx, m)) ?? movementAmendBlock(m);
    if (block) throw new BadRequestException(block);

    const quantity = dto.quantity ?? (m.type === 'ADJUSTMENT' ? m.quantityDelta : Math.abs(m.quantityDelta));
    if (m.type !== 'ADJUSTMENT' && quantity <= 0) throw new BadRequestException('مقدار باید بزرگ‌تر از صفر باشد');
    if (m.type === 'ADJUSTMENT' && quantity === 0) throw new BadRequestException('مقدار اصلاح نمی‌تواند صفر باشد');
    if (dto.unitCost !== undefined && m.type !== 'RECEIPT') throw new BadRequestException('بهای واحد فقط برای رسید ورودی معنا دارد');
    const newDelta = deltaFor(m.type, quantity);
    const newUnitCost = dto.unitCost !== undefined ? dto.unitCost : m.unitCost;
    const newReference = dto.reference !== undefined ? dto.reference.trim() || null : m.reference;
    const newNote = dto.note !== undefined ? dto.note.trim() || null : m.note;

    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    if (newDelta !== m.quantityDelta) changes.push({ field: 'مقدار', from: m.quantityDelta, to: newDelta });
    if (newUnitCost !== m.unitCost) changes.push({ field: 'بهای واحد', from: m.unitCost, to: newUnitCost });
    if (newReference !== m.reference) changes.push({ field: 'مرجع', from: m.reference, to: newReference });
    if (newNote !== m.note) changes.push({ field: 'توضیح', from: m.note, to: newNote });
    if (changes.length === 0) throw new BadRequestException('هیچ تغییری نسبت به مقدار فعلی انجام نشده است');

    if (newDelta !== m.quantityDelta) {
      const history = await this.loadHistory(ctx.tenantDb, m.productId, m.warehouseId);
      const r = breaksStockHistory(history, { id, newDelta });
      if (r.broken) throw new BadRequestException(this.stockMessage(m.product.name, m.product.unit, r.at, r.minAfter));
    }

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
    const costMatters = m.type === 'RECEIPT' && (newDelta !== m.quantityDelta || newUnitCost !== m.unitCost);
    const costMethod = costMatters ? await this.costing.getMethod(ctx) : 'LAST_COST';
    const autoSale = costMatters ? await this.costing.getAutoSalePriceEnabled(ctx) : false;
    const revisionNo = m.editCount + 1;
    const now = new Date();
    const before = { quantityDelta: m.quantityDelta, unitCost: m.unitCost, reference: m.reference, note: m.note };
    const after = { quantityDelta: newDelta, unitCost: newUnitCost, reference: newReference, note: newNote };

    const result = await ctx.tenantDb.$transaction(async (tx) => {
      const guard = await tx.stockMovement.updateMany({
        where: { id, voidedAt: null, editCount: m.editCount },
        data: { quantityDelta: newDelta, unitCost: newUnitCost, reference: newReference, note: newNote, editedAt: now, editCount: { increment: 1 } },
      });
      if (guard.count !== 1) throw new ConflictException('این رسید/حواله هم‌زمان تغییر کرد؛ صفحه را تازه کنید');
      await tx.documentRevision.create({
        data: {
          entityType: 'stock_movement', entityId: id, revisionNo, action: 'EDIT', reason: dto.reason.trim(),
          before: before as never, after: after as never, changes: changes as never, userId, userName: user?.name ?? null,
        },
      });
      if (costMatters) await refreshProductCost(tx, m.productId, costMethod, autoSale);
      await tx.activityLog.create({
        data: { userId, action: 'warehouse.movement.edited', entityType: 'Product', entityId: m.productId, metadata: { movementId: id, type: m.type, reason: dto.reason.trim(), changes } as never },
      });
      return tx.stockMovement.findUniqueOrThrow({ where: { id } });
    });
    return result;
  }

  async void(ctx: TenantRequestContext, id: string, reason: string) {
    const m = await ctx.tenantDb.stockMovement.findUnique({ where: { id }, include: { product: true, warehouse: true } });
    if (!m) throw new NotFoundException('رسید/حواله یافت نشد');
    const block = (await this.linkedBlock(ctx, m)) ?? movementAmendBlock(m);
    if (block) throw new BadRequestException(block);

    // ابطال یعنی «این ردیف هرگز نبوده»: هیچ ردیف بعدی نباید به موجودی آن تکیه کرده باشد.
    const history = await this.loadHistory(ctx.tenantDb, m.productId, m.warehouseId);
    const r = breaksStockHistory(history, { id, newDelta: null });
    if (r.broken) throw new BadRequestException(this.stockMessage(m.product.name, m.product.unit, r.at, r.minAfter));

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
    const costMatters = m.type === 'RECEIPT' && m.unitCost != null;
    const costMethod = costMatters ? await this.costing.getMethod(ctx) : 'LAST_COST';
    const autoSale = costMatters ? await this.costing.getAutoSalePriceEnabled(ctx) : false;
    const now = new Date();
    const label = TYPE_FA[m.type] ?? 'حرکت انبار';

    await ctx.tenantDb.$transaction(async (tx) => {
      const guard = await tx.stockMovement.updateMany({
        where: { id, voidedAt: null },
        data: { voidedAt: now, voidReason: reason, voidedByUserId: userId, editedAt: now, editCount: { increment: 1 } },
      });
      if (guard.count !== 1) throw new ConflictException('این رسید/حواله هم‌زمان تغییر کرد؛ صفحه را تازه کنید');
      await tx.stockMovement.create({
        data: {
          productId: m.productId,
          warehouseId: m.warehouseId,
          type: 'ADJUSTMENT',
          quantityDelta: -m.quantityDelta,
          reference: `ابطال ${label}${m.reference ? ` «${m.reference}»` : ''}`,
          note: reason,
          origin: 'MANUAL',
          reversalOfId: id,
          createdByUserId: userId,
        },
      });
      await tx.documentRevision.create({
        data: {
          entityType: 'stock_movement', entityId: id, revisionNo: m.editCount + 1, action: 'VOID', reason,
          before: { quantityDelta: m.quantityDelta, unitCost: m.unitCost, reference: m.reference } as never,
          after: { voided: true } as never,
          changes: [{ field: 'وضعیت', from: 'فعال', to: 'باطل' }] as never, userId, userName: user?.name ?? null,
        },
      });
      if (costMatters) await refreshProductCost(tx, m.productId, costMethod, autoSale);
      await tx.activityLog.create({
        data: { userId, action: 'warehouse.movement.voided', entityType: 'Product', entityId: m.productId, metadata: { movementId: id, type: m.type, quantityDelta: m.quantityDelta, reason } as never },
      });
    });
    return { success: true };
  }
}
