import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { CostingService } from '../warehouse/costing.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import type { RecordPurchasePaymentDto } from './dto/record-purchase-payment.dto.js';

const PURCHASING_SETTINGS_MODULE = 'purchasing';
const APPROVAL_THRESHOLD_KEY = 'approvalThreshold';

// See src/accounting/default-chart-of-accounts.ts — same convention as the
// sales cycle (src/sales/invoices.service.ts), mirrored for purchasing.
const ACCOUNT = {
  CASH: '1010',
  BANK: '1020',
  PAYABLE: '2010',
  INVENTORY: '1040',
};

const ORDER_INCLUDE = {
  supplier: { select: { id: true, name: true, company: true, phone: true, email: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      currency: { select: { code: true, symbol: true } },
    },
  },
  payments: { orderBy: { paidAt: 'desc' as const } },
};

@Injectable()
export class PurchaseOrdersService implements OnModuleInit {
  constructor(
    private readonly costing: CostingService,
    private readonly automation: AutomationEngineService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('PURCHASE_ORDER', {
      approve: async (ctx, id) => {
        await this.approve(ctx, id, { fromApprovals: true });
      },
      reject: async (ctx, id, opts) => {
        await this.reject(ctx, id, opts.note, { fromApprovals: true });
      },
      describe: async (ctx, id) => {
        const o = await ctx.tenantDb.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { supplier: true, lines: true } });
        return {
          fields: [
            { label: 'شماره سفارش', value: String(o.orderNo) },
            { label: 'تأمین‌کننده', value: `${o.supplier.name}${o.supplier.phone ? ` — ${o.supplier.phone}` : ''}` },
            { label: 'اقلام', value: o.lines.map((l) => `${l.description} × ${l.quantity} @ ${l.unitCost.toLocaleString('en-US')}`).join('\n') },
            { label: 'جمع کل', value: `${o.total.toLocaleString('en-US')} تومان` },
            { label: 'تحویل مورد انتظار', value: o.expectedAt ? o.expectedAt.toLocaleDateString('fa-IR') : '—' },
            { label: 'یادداشت', value: o.notes ?? '—' },
          ],
        };
      },
    });
  }

  async list(ctx: TenantRequestContext, scope: Record<string, unknown>) {
    const orders = await ctx.tenantDb.purchaseOrder.findMany({
      where: scope,
      include: {
        supplier: { select: { id: true, name: true, company: true } },
        _count: { select: { returns: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // hasReturn: مطابق همان اصلاح در sales/invoices.service.ts — سفارشی که مرجوعی
    // خرید دارد نباید همچنان «پرداخت‌شده» نشان داده شود؛ status واقعی دست‌نخورده می‌ماند.
    return orders.map(({ _count, ...o }) => ({ ...o, hasReturn: _count.returns > 0 }));
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const order = await ctx.tenantDb.purchaseOrder.findFirst({
      where: { id, ...scope },
      include: { ...ORDER_INCLUDE, _count: { select: { returns: true } } },
    });
    if (!order) throw new NotFoundException('سفارش خرید یافت نشد');
    const { _count, ...rest } = order;
    return { ...rest, hasReturn: _count.returns > 0 };
  }

  async create(ctx: TenantRequestContext, dto: CreatePurchaseOrderDto) {
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.supplierId } });
    const createdByUserId = await resolveTenantUserId(ctx);

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitCost }));
    const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const threshold = await this.getApprovalThreshold(ctx);

    const order = await ctx.tenantDb.purchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
        notes: dto.notes,
        subtotal: total,
        total,
        createdByUserId,
        approvalStatus: threshold != null && total >= threshold ? 'PENDING' : 'NOT_REQUIRED',
        lines: { create: lines },
      },
      include: ORDER_INCLUDE,
    });
    if (order.approvalStatus === 'PENDING') {
      await this.approvals.request(ctx, {
        moduleCode: 'purchasing',
        entityType: 'PURCHASE_ORDER',
        entityId: order.id,
        title: `تأیید سفارش خرید ${order.orderNo}`,
        summary: `${order.supplier?.name ?? ""} — ${order.total.toLocaleString('en-US')} تومان`,
        link: '/purchasing',
        requestedByUserId: createdByUserId ?? undefined,
      });
    }
    return order;
  }

  async getApprovalThreshold(ctx: TenantRequestContext): Promise<number | null> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: PURCHASING_SETTINGS_MODULE, key: APPROVAL_THRESHOLD_KEY } },
    });
    const value = row ? Number(row.value) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async setApprovalThreshold(ctx: TenantRequestContext, threshold: number | null): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: PURCHASING_SETTINGS_MODULE, key: APPROVAL_THRESHOLD_KEY } },
      create: { moduleCode: PURCHASING_SETTINGS_MODULE, key: APPROVAL_THRESHOLD_KEY, value: threshold ?? 0 },
      update: { value: threshold ?? 0 },
    });
  }

  /** Only the tenant owner/admin may approve or reject — there's no manager-chain concept for spending sign-off like there is for HR leave. */
  async approve(ctx: TenantRequestContext, id: string, opts?: { fromApprovals?: boolean }) {
    this.assertApprover(ctx);
    const order = await ctx.tenantDb.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('سفارش خرید یافت نشد');
    if (order.approvalStatus !== 'PENDING') throw new BadRequestException('این سفارش در انتظار تأیید نیست');

    const approvedByUserId = await resolveTenantUserId(ctx);
    const updated = await ctx.tenantDb.purchaseOrder.update({
      where: { id },
      data: { approvalStatus: 'APPROVED', approvedByUserId, approvedAt: new Date() },
      include: ORDER_INCLUDE,
    });
    if (!opts?.fromApprovals) await this.approvals.closeForEntity(ctx, 'PURCHASE_ORDER', id, 'APPROVED');
    await this.automation.emit(ctx, 'purchasing.order.approved', {
      orderNo: updated.orderNo,
      supplierName: updated.supplier.name,
      supplierPhone: updated.supplier.phone,
      total: updated.total,
    });
    return updated;
  }

  async reject(ctx: TenantRequestContext, id: string, reason?: string, opts?: { fromApprovals?: boolean }) {
    this.assertApprover(ctx);
    const order = await ctx.tenantDb.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('سفارش خرید یافت نشد');
    if (order.approvalStatus !== 'PENDING') throw new BadRequestException('این سفارش در انتظار تأیید نیست');

    const approvedByUserId = await resolveTenantUserId(ctx);
    if (!opts?.fromApprovals) await this.approvals.closeForEntity(ctx, 'PURCHASE_ORDER', id, 'REJECTED');
    return ctx.tenantDb.purchaseOrder.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        approvedByUserId,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
      include: ORDER_INCLUDE,
    });
  }

  private assertApprover(ctx: TenantRequestContext): void {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر می‌تواند سفارش خرید را تأیید یا رد کند');
    }
  }

  /**
   * The purchasing mirror of InvoicesService.confirm(): issues a stock-in
   * receipt per line (inventory goes up for real) and posts Dr Inventory /
   * Cr Accounts Payable for the order total. Also refreshes each product's
   * costPrice per the tenant's chosen costing method (see CostingService —
   * last-cost, weighted-average, or FIFO).
   */
  async receive(ctx: TenantRequestContext, id: string) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const order = await ctx.tenantDb.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('سفارش خرید یافت نشد');
    if (order.status !== 'DRAFT') throw new BadRequestException('فقط سفارش پیش‌نویس قابل دریافت است');
    if (order.approvalStatus === 'PENDING') {
      throw new BadRequestException('این سفارش نیازمند تأیید مدیر است — ابتدا باید تأیید شود');
    }
    if (order.approvalStatus === 'REJECTED') {
      throw new BadRequestException('این سفارش رد شده و قابل دریافت نیست');
    }

    const userId = await resolveTenantUserId(ctx);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);
    const inventory = await this.getAccount(ctx, ACCOUNT.INVENTORY);
    const payable = await this.getAccount(ctx, ACCOUNT.PAYABLE);
    const receiptLines = order.lines.filter((l) => l.productId);
    const nextCostPrices = await Promise.all(
      receiptLines.map((l) => this.costing.nextCostPriceOnReceipt(ctx, l.productId!, l.quantity, l.unitCost)),
    );
    // اگر کالایی درصد سود دارد و MANUAL نشده و تنظیم سراسری فعال است، قیمت
    // فروشش هم همراه بهای تمام‌شده‌ی تازه‌ی این رسید بازمحاسبه می‌شود.
    const nextSalePrices = await Promise.all(
      receiptLines.map((l, i) => this.costing.nextSalePriceOnReceipt(ctx, l.productId!, nextCostPrices[i])),
    );

    const [entry] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `سفارش خرید شماره ${order.orderNo}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: inventory.id, debit: BigInt(order.total), credit: BigInt(0) },
              { accountId: payable.id, debit: BigInt(0), credit: BigInt(order.total) },
            ],
          },
        },
      }),
      ...order.lines
        .filter((l) => l.productId)
        .map((l) =>
          ctx.tenantDb.stockMovement.create({
            data: {
              productId: l.productId!,
              warehouseId: warehouse.id,
              type: 'RECEIPT',
              quantityDelta: l.quantity,
              unitCost: l.unitCost,
              reference: `سفارش خرید #${order.orderNo}`,
              createdByUserId: userId,
            },
          }),
        ),
      ...receiptLines.map((l, i) =>
        ctx.tenantDb.product.update({
          where: { id: l.productId! },
          data: {
            costPrice: nextCostPrices[i],
            ...(nextSalePrices[i] != null ? { salePrice: nextSalePrices[i]!, salePriceUpdatedAt: new Date() } : {}),
          },
        }),
      ),
    ]);

    return ctx.tenantDb.purchaseOrder.update({
      where: { id },
      data: { status: 'RECEIVED', receivedAt: new Date(), journalEntryId: entry.id },
      include: ORDER_INCLUDE,
    });
  }

  async recordPayment(ctx: TenantRequestContext, id: string, dto: RecordPurchasePaymentDto) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const order = await ctx.tenantDb.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('سفارش خرید یافت نشد');
    if (order.status !== 'RECEIVED' && order.status !== 'PARTIALLY_PAID') {
      throw new BadRequestException('فقط سفارش دریافت‌شده قابل ثبت پرداخت است');
    }
    const remaining = order.total - order.paidAmount;
    if (dto.amount > remaining) throw new BadRequestException('مبلغ پرداخت از باقی‌مانده‌ی سفارش بیشتر است');

    const method = dto.method ?? 'CASH';
    if (method === 'CHECK' && (!dto.checkSayadId || !dto.checkDueDate)) {
      throw new BadRequestException('برای پرداخت چکی، شماره صیادی و تاریخ سررسید الزامی است');
    }
    const cashAccountCode = method === 'CASH' || method === 'POS' ? ACCOUNT.CASH : ACCOUNT.BANK;
    const cashAccount = await this.getAccount(ctx, cashAccountCode);
    const payable = await this.getAccount(ctx, ACCOUNT.PAYABLE);
    const userId = await resolveTenantUserId(ctx);

    const newPaidAmount = order.paidAmount + dto.amount;
    const newStatus = newPaidAmount >= order.total ? 'PAID' : 'PARTIALLY_PAID';

    await ctx.tenantDb.$transaction([
      ctx.tenantDb.purchasePayment.create({
        data: { orderId: id, amount: dto.amount, method, note: dto.note },
      }),
      ...(method === 'CHECK'
        ? [
            ctx.tenantDb.check.create({
              data: {
                direction: 'ISSUED',
                sayadId: dto.checkSayadId!,
                amount: dto.amount,
                dueDate: new Date(dto.checkDueDate!),
                bankName: dto.checkBankName,
                contactId: order.supplierId,
                purchaseOrderId: order.id,
                createdByUserId: userId,
              },
            }),
          ]
        : []),
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `پرداخت بابت سفارش خرید شماره ${order.orderNo}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: payable.id, debit: BigInt(dto.amount), credit: BigInt(0) },
              { accountId: cashAccount.id, debit: BigInt(0), credit: BigInt(dto.amount) },
            ],
          },
        },
      }),
      ctx.tenantDb.purchaseOrder.update({
        where: { id },
        data: { paidAmount: newPaidAmount, status: newStatus },
      }),
    ]);

    return ctx.tenantDb.purchaseOrder.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
  }

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }

  /** ویرایش سفارش خرید پیش‌نویس (قبل از دریافت کالا). مبلغ تغییر کند، نیاز به تأیید مدیر دوباره سنجیده می‌شود. */
  async updateDraft(ctx: TenantRequestContext, id: string, dto: CreatePurchaseOrderDto) {
    const existing = await ctx.tenantDb.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('سفارش خرید یافت نشد');
    if (existing.status !== 'DRAFT') throw new BadRequestException('سفارش دریافت‌شده ویرایش نمی‌شود؛ از مرجوعی خرید استفاده کنید');
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.supplierId } });

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitCost }));
    const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const threshold = await this.getApprovalThreshold(ctx);
    const needsApproval = threshold != null && total >= threshold;

    await ctx.tenantDb.purchaseOrderLine.deleteMany({ where: { orderId: id } });
    const updated = await ctx.tenantDb.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: dto.supplierId,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        notes: dto.notes,
        subtotal: total,
        total,
        approvalStatus: needsApproval ? 'PENDING' : 'NOT_REQUIRED',
        approvedByUserId: null,
        approvedAt: null,
        lines: { create: lines },
      },
      include: ORDER_INCLUDE,
    });
    await this.approvals.closeForEntity(ctx, 'PURCHASE_ORDER', id, 'REJECTED');
    if (needsApproval) {
      await this.approvals.request(ctx, {
        moduleCode: 'purchasing',
        entityType: 'PURCHASE_ORDER',
        entityId: id,
        title: `تأیید سفارش خرید ${updated.orderNo}`,
        summary: `${updated.supplier?.name ?? ''} — ${updated.total.toLocaleString('en-US')} تومان (ویرایش‌شده)`,
        link: '/purchasing',
      });
    }
    return updated;
  }

  async removeDraft(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('سفارش خرید یافت نشد');
    if (existing.status !== 'DRAFT') throw new BadRequestException('فقط سفارش پیش‌نویس حذف می‌شود؛ سفارش دریافت‌شده را با مرجوعی برگردانید');
    await ctx.tenantDb.purchaseOrder.delete({ where: { id } });
    await this.approvals.closeForEntity(ctx, 'PURCHASE_ORDER', id, 'REJECTED');
    return { success: true };
  }

  /** لغو سفارش دریافت‌نشده — سابقه می‌ماند ولی دیگر قابل دریافت/پرداخت نیست. */
  async cancelDraft(ctx: TenantRequestContext, id: string, reason: string) {
    const existing = await ctx.tenantDb.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('سفارش خرید یافت نشد');
    if (existing.status !== 'DRAFT') throw new BadRequestException('فقط سفارش دریافت‌نشده لغو می‌شود');
    const updated = await ctx.tenantDb.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', notes: `${existing.notes ? `${existing.notes}\n` : ''}لغو شد: ${reason}` },
      include: ORDER_INCLUDE,
    });
    await this.approvals.closeForEntity(ctx, 'PURCHASE_ORDER', id, 'REJECTED');
    return updated;
  }
}
