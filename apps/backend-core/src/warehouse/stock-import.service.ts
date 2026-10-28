import { createHash } from 'node:crypto';
import { assertPeriodOpen } from '../accounting/periods/period-lock.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ensureDefaultChartOfAccounts, ensureOpeningBalanceAccount, OPENING_BALANCE_ACCOUNT_CODE } from '../accounting/default-chart-of-accounts.js';
import { buildExcelBuffer, parseExcelBuffer } from '../common/excel.js';
import { ensureDefaultWarehouse } from './default-warehouse.js';
import { CostingService, refreshProductCost } from './costing.service.js';
import { breaksStockHistoryRemovingMany, isActiveMovement } from './movement-rules.js';
import { STOCK_IMPORT_HEADERS, STOCK_IMPORT_MAX_ROWS, planOpeningStockImport, type ImportPlan } from './stock-import.rules.js';

const OPENING_REFERENCE = 'موجودی اولیه — ورود اکسل';
const INVENTORY = '1040';
const OPENING_EQUITY = OPENING_BALANCE_ACCOUNT_CODE; // حساب افتتاحیه ۳۰۲۰
const LEGACY_EQUITY = '3010'; // سرمایه — فقط جایگزین اگر ۳۰۲۰ نبود

export function hashFile(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * ورود موجودی اولیه از اکسل (مهاجرت از نرم‌افزار قبلی): قالب، پیش‌نمایش (dry-run) با خطاهای فارسی، و ثبت اتمیک.
 * ثبت = یک تراکنش: کالاهای جدید (اختیاری) + دسته (StockImportBatch) + حرکت‌های RECEIPT «موجودی اولیه» + سند افتتاحیه
 * (بدهکار موجودی کالا ۱۰۴۰ / بستانکار حساب افتتاحیه ۳۰۲۰؛ در نبودِ آن ۳۰۱۰ سرمایه) اگر ماژول حسابداری نصب باشد.
 * ایدمپوتنسی: هش فایل — فایل یکسان دوباره وارد نمی‌شود مگر دسته‌ی قبلی باطل شده باشد.
 */
@Injectable()
export class StockImportService {
  constructor(
    private readonly costing: CostingService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async template(): Promise<Buffer> {
    return buildExcelBuffer(
      [...STOCK_IMPORT_HEADERS],
      [
        { 'کد کالا': 'P-1001', 'نام کالا': 'کالای نمونه', انبار: 'انبار مرکزی', تعداد: 120, 'بهای واحد (تومان)': 250000, واحد: 'عدد', 'شماره لات/بچ': 'B-2026-01', 'محل قفسه': 'A-12' },
      ],
      'موجودی اولیه',
    );
  }

  private async plan(ctx: TenantRequestContext, buffer: Buffer, createMissing: boolean): Promise<ImportPlan> {
    let rows;
    try {
      rows = await parseExcelBuffer(buffer);
    } catch {
      throw new BadRequestException('فایل اکسل خوانده نشد؛ فایل را با قالب «دانلود نمونه» بسازید (xlsx)');
    }
    if (rows.length === 0) throw new BadRequestException('فایل خالی است');
    const firstKeys = Object.keys(rows[0]);
    const missingHeaders = ['تعداد'].filter((h) => !firstKeys.includes(h));
    if (missingHeaders.length || (!firstKeys.includes('کد کالا') && !firstKeys.includes('نام کالا'))) {
      throw new BadRequestException(`ستون‌های الزامی فایل پیدا نشد (کد کالا یا نام کالا، تعداد). ستون‌های قالب: ${STOCK_IMPORT_HEADERS.join('، ')}`);
    }
    const [products, warehouses, existing] = await Promise.all([
      ctx.tenantDb.product.findMany({ select: { id: true, sku: true, name: true, unit: true, costPrice: true } }),
      ctx.tenantDb.warehouse.findMany({ select: { id: true, name: true, isDefault: true } }),
      ctx.tenantDb.stockMovement.groupBy({ by: ['productId', 'warehouseId'] }),
    ]);
    return planOpeningStockImport(rows, {
      products,
      warehouses,
      createMissing,
      existingStockKeys: new Set(existing.map((e) => `${e.productId}|${e.warehouseId}`)),
    });
  }

  private async findLiveBatch(ctx: TenantRequestContext, fileHash: string) {
    return ctx.tenantDb.stockImportBatch.findFirst({
      where: { fileHash, voidedAt: null },
      select: { id: true, fileName: true, createdAt: true, rowCount: true },
    });
  }

  /** dry-run: هیچ‌چیز نوشته نمی‌شود. */
  async preview(ctx: TenantRequestContext, fileBase64: string, createMissing: boolean) {
    const buffer = Buffer.from(fileBase64, 'base64');
    const fileHash = hashFile(buffer);
    const plan = await this.plan(ctx, buffer, createMissing);
    const duplicateOf = await this.findLiveBatch(ctx, fileHash);
    return {
      fileHash,
      duplicateOf,
      maxRows: STOCK_IMPORT_MAX_ROWS,
      ...plan,
      canCommit: plan.errorCount === 0 && plan.okCount > 0 && !duplicateOf && !plan.tooManyRows,
    };
  }

  async commit(ctx: TenantRequestContext, input: { fileBase64: string; fileName?: string; fileHash: string; createMissing: boolean; confirm: boolean }) {
    if (!input.confirm) throw new BadRequestException('ثبت نهایی نیازمند تأیید صریح است');
    const buffer = Buffer.from(input.fileBase64, 'base64');
    const fileHash = hashFile(buffer);
    if (fileHash !== input.fileHash) throw new BadRequestException('فایل با پیش‌نمایش تأییدشده یکی نیست؛ دوباره پیش‌نمایش بگیرید');
    const dup = await this.findLiveBatch(ctx, fileHash);
    if (dup) throw new ConflictException('این فایل قبلاً وارد شده است (ورود تکراری). برای ورود دوباره، ابتدا دسته‌ی قبلی را باطل کنید');
    const plan = await this.plan(ctx, buffer, input.createMissing);
    if (plan.tooManyRows) throw new BadRequestException(`حداکثر ${STOCK_IMPORT_MAX_ROWS} ردیف در هر ورود مجاز است؛ فایل را تقسیم کنید`);
    if (plan.errorCount > 0) throw new BadRequestException(`${plan.errorCount} ردیف خطا دارد؛ ثبت جزئی انجام نمی‌شود — فایل را اصلاح و دوباره پیش‌نمایش بگیرید`);
    if (plan.okCount === 0) throw new BadRequestException('ردیف معتبری برای ثبت وجود ندارد');

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const accounting = await isModuleEnabled(this.controlDb, ctx.tenantId, 'accounting').catch(() => false);
    let inventoryId: string | null = null;
    let equityId: string | null = null;
    const totalValue = plan.rows.reduce((s, r) => s + r.quantity * (r.unitCost ?? 0), 0);
    if (accounting && totalValue > 0) {
      await ensureDefaultChartOfAccounts(ctx.tenantDb);
      await ensureOpeningBalanceAccount(ctx.tenantDb).catch(() => undefined);
      const [inv, openingEq, legacyEq] = await Promise.all([
        ctx.tenantDb.account.findUnique({ where: { code: INVENTORY } }),
        ctx.tenantDb.account.findUnique({ where: { code: OPENING_EQUITY } }),
        ctx.tenantDb.account.findUnique({ where: { code: LEGACY_EQUITY } }),
      ]);
      const eq = openingEq?.type === 'EQUITY' ? openingEq : legacyEq; // اگر ۳۰۲۰ قبلاً با معنای دیگری ساخته شده باشد، به ۳۰۱۰ برمی‌گردیم
      if (!inv || !eq) throw new BadRequestException(`کدینگ حسابداری ${INVENTORY} یا ${OPENING_EQUITY} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
      inventoryId = inv.id;
      equityId = eq.id;
    }
    await ensureDefaultWarehouse(ctx.tenantDb);

    // بهای جدید هر کالای موجود (میانگین وزنی ردیف‌های همان کالا) — پیش از تراکنش، بر پایه‌ی موجودی قبل از ورود.
    const perProduct = new Map<string, { qty: number; value: number }>();
    for (const r of plan.rows) {
      if (!r.productId || !r.unitCost) continue;
      const e = perProduct.get(r.productId) ?? { qty: 0, value: 0 };
      e.qty += r.quantity;
      e.value += r.quantity * r.unitCost;
      perProduct.set(r.productId, e);
    }
    const costUpdates: Array<{ productId: string; cost: number; sale: number | null }> = [];
    for (const [productId, e] of perProduct) {
      const avg = Math.round(e.value / e.qty);
      const cost = await this.costing.nextCostPriceOnReceipt(ctx, productId, e.qty, avg);
      costUpdates.push({ productId, cost, sale: await this.costing.nextSalePriceOnReceipt(ctx, productId, cost) });
    }

    const now = new Date();
    const batch = await ctx.tenantDb.$transaction(
      async (tx) => {
        const b = await tx.stockImportBatch.create({
          data: {
            fileName: input.fileName ?? null,
            fileHash,
            rowCount: plan.okCount,
            totalQuantity: plan.totalQuantity,
            totalValue: BigInt(totalValue),
            createdByUserId: userId,
          },
        });

        // کالاهای جدید (یک کالا برای همه‌ی ردیف‌هایش در انبارهای مختلف)
        const created = new Map<string, string>();
        let seq = 0;
        for (const r of plan.rows) {
          if (!r.createsProduct) continue;
          const key = (r.sku || r.name).toLowerCase();
          if (created.has(key)) continue;
          const sku = r.sku || `OB-${b.id.slice(0, 6)}-${++seq}`;
          const clash = await tx.product.findUnique({ where: { sku }, select: { id: true } });
          if (clash) throw new ConflictException(`کدی که برای کالای جدید «${r.name}» لازم است قبلاً وجود دارد (${sku}) — هم‌زمان کالایی با این کد ساخته شد؛ دوباره پیش‌نمایش بگیرید`);
          const p = await tx.product.create({ data: { sku, name: r.name, unit: r.unit, costPrice: r.unitCost ?? 0 } });
          created.set(key, p.id);
        }

        for (const r of plan.rows) {
          const productId = r.productId ?? created.get((r.sku || r.name).toLowerCase());
          if (!productId) throw new BadRequestException(`کالای ردیف ${r.row} پیدا نشد`);
          const noteParts = [r.lot ? `لات: ${r.lot}` : '', r.location ? `محل: ${r.location}` : ''].filter(Boolean);
          await tx.stockMovement.create({
            data: {
              productId,
              warehouseId: r.warehouseId!,
              type: 'RECEIPT',
              quantityDelta: r.quantity,
              unitCost: r.unitCost ?? undefined,
              reference: OPENING_REFERENCE,
              note: noteParts.length ? noteParts.join(' — ') : undefined,
              origin: 'OPENING_IMPORT',
              importBatchId: b.id,
              createdByUserId: userId,
            },
          });
        }
        for (const u of costUpdates) {
          await tx.product.update({
            where: { id: u.productId },
            data: { costPrice: u.cost, ...(u.sale != null ? { salePrice: u.sale, salePriceUpdatedAt: now } : {}) },
          });
        }

        let journalEntryId: string | null = null;
        if (inventoryId && equityId) {
          await assertPeriodOpen(tx, now);
          const entry = await tx.journalEntry.create({
            data: {
              date: now,
              description: `موجودی اولیه انبار (ورود اکسل) — دسته ${b.id.slice(0, 8)}`,
              status: 'POSTED',
              postedAt: now,
              createdByUserId: userId ?? undefined,
              lines: {
                create: [
                  { accountId: inventoryId, debit: BigInt(totalValue), credit: BigInt(0) },
                  { accountId: equityId, debit: BigInt(0), credit: BigInt(totalValue) },
                ],
              },
            },
          });
          journalEntryId = entry.id;
        }
        const finalBatch = await tx.stockImportBatch.update({
          where: { id: b.id },
          data: { createdProducts: created.size, journalEntryId },
        });
        await tx.activityLog.create({
          data: {
            userId,
            action: 'warehouse.stock_import.committed',
            entityType: 'StockImportBatch',
            entityId: b.id,
            metadata: { fileName: input.fileName ?? null, rows: plan.okCount, totalQuantity: plan.totalQuantity, totalValue, createdProducts: created.size, journal: !!journalEntryId } as never,
          },
        });
        return finalBatch;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { batchId: batch.id, rows: plan.okCount, createdProducts: batch.createdProducts, totalQuantity: plan.totalQuantity, totalValue, journalPosted: !!batch.journalEntryId };
  }

  async list(ctx: TenantRequestContext) {
    const rows = await ctx.tenantDb.stockImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((b) => ({ ...b, totalValue: Number(b.totalValue) }));
  }

  /**
   * ابطال کل دسته‌ی موجودی اولیه: سند افتتاحیه با سند معکوس خنثی، ردیف‌ها ابطال نرم (با ردیف معکوس).
   * اگر حواله/فاکتوری بعد از ورود از این موجودی خروج زده باشد (موجودی منفی می‌شد) ابطال مسدود است.
   */
  async voidBatch(ctx: TenantRequestContext, id: string, reason: string) {
    const batch = await ctx.tenantDb.stockImportBatch.findUnique({ where: { id }, include: { movements: true } });
    if (!batch) throw new NotFoundException('دسته‌ی ورود یافت نشد');
    if (batch.voidedAt) throw new BadRequestException('این دسته قبلاً باطل شده است');
    const rows = batch.movements.filter((m) => !m.voidedAt);

    const pairs = new Map<string, string[]>();
    for (const m of rows) pairs.set(`${m.productId}|${m.warehouseId}`, [...(pairs.get(`${m.productId}|${m.warehouseId}`) ?? []), m.id]);
    for (const [key, ids] of pairs) {
      const [productId, warehouseId] = key.split('|');
      const all = await ctx.tenantDb.stockMovement.findMany({
        where: { productId, warehouseId },
        select: { id: true, createdAt: true, quantityDelta: true, voidedAt: true, reversalOfId: true },
      });
      const history = all.filter(isActiveMovement).map(({ id: mid, createdAt, quantityDelta }) => ({ id: mid, createdAt, quantityDelta }));
      const r = breaksStockHistoryRemovingMany(history, new Set(ids));
      if (r.broken) {
        const p = await ctx.tenantDb.product.findUnique({ where: { id: productId }, select: { name: true } });
        throw new BadRequestException(`ابطال این دسته موجودی «${p?.name ?? 'کالا'}» را منفی می‌کند (بعد از ورود از آن خروج ثبت شده). ابتدا آن حواله‌ها/فاکتورها را اصلاح کنید`);
      }
    }

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
    const original = batch.journalEntryId
      ? await ctx.tenantDb.journalEntry.findUnique({ where: { id: batch.journalEntryId }, include: { lines: true } })
      : null;
    const method = await this.costing.getMethod(ctx);
    const autoSale = await this.costing.getAutoSalePriceEnabled(ctx);
    const now = new Date();

    await ctx.tenantDb.$transaction(
      async (tx) => {
        const guard = await tx.stockImportBatch.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: now, voidReason: reason, voidedByUserId: userId } });
        if (guard.count !== 1) throw new ConflictException('این دسته هم‌زمان باطل شد');
        for (const m of rows) {
          await tx.stockMovement.update({ where: { id: m.id }, data: { voidedAt: now, voidReason: reason, voidedByUserId: userId } });
          await tx.stockMovement.create({
            data: {
              productId: m.productId,
              warehouseId: m.warehouseId,
              type: 'ADJUSTMENT',
              quantityDelta: -m.quantityDelta,
              reference: `ابطال ${OPENING_REFERENCE}`,
              note: reason,
              origin: 'OPENING_IMPORT',
              reversalOfId: m.id,
              importBatchId: id,
              createdByUserId: userId,
            },
          });
        }
        if (original) {
          await assertPeriodOpen(tx, original.date);
          await assertPeriodOpen(tx, now);
          await tx.journalEntry.create({
            data: {
              date: now,
              description: `ابطال موجودی اولیه (دسته ${id.slice(0, 8)}): ${reason}`,
              status: 'POSTED',
              postedAt: now,
              reversalOfId: original.id,
              createdByUserId: userId ?? undefined,
              lines: { create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })) },
            },
          });
          await tx.journalEntry.update({ where: { id: original.id }, data: { voidedAt: now, voidReason: reason } });
        }
        for (const pid of new Set(rows.map((m) => m.productId))) await refreshProductCost(tx, pid, method, autoSale);
        await tx.documentRevision.create({
          data: {
            entityType: 'stock_import_batch', entityId: id, revisionNo: 1, action: 'VOID', reason,
            before: { rows: rows.length } as never, after: { voided: true } as never,
            changes: [{ field: 'وضعیت', from: 'فعال', to: 'باطل' }] as never, userId, userName: user?.name ?? null,
          },
        });
        await tx.activityLog.create({
          data: { userId, action: 'warehouse.stock_import.voided', entityType: 'StockImportBatch', entityId: id, metadata: { reason, rows: rows.length } as never },
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { success: true };
  }
}
