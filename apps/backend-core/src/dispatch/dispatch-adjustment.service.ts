import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { InvoicesService } from '../sales/invoices.service.js';
import { DispatchRuleError } from './dispatch-state.js';
import { proposeInvoiceAdjustment, type LineChange } from './dispatch-weight.js';
import { isManagerCtx, logEvent, resolveActor, shipmentLink, type Actor } from './dispatch-common.js';

/**
 * تعدیل اقلام فاکتور پیش‌نویس بر اساس وزن واقعی بار: پیشنهاد → تأیید مدیر/حسابدار (کارتابل تأیید یا صفحه‌ی بار)
 * → اعمال روی اقلام → نهایی‌شدن و ثبت خودکار سند حسابداری با همان مسیر موجود (InvoicesService.confirm).
 */
@Injectable()
export class DispatchAdjustmentService implements OnModuleInit {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('DISPATCH_ADJUSTMENT', {
      approve: async (ctx, id, opts) => {
        await this.decide(ctx, id, true, opts.note);
      },
      reject: async (ctx, id, opts) => {
        await this.decide(ctx, id, false, opts.note);
      },
      describe: async (ctx, id) => {
        const a = await ctx.tenantDb.dispatchInvoiceAdjustment.findUniqueOrThrow({ where: { id } });
        const inv = await ctx.tenantDb.salesInvoice.findUniqueOrThrow({ where: { id: a.invoiceId }, include: { contact: true } });
        const changes = a.lineChanges as unknown as LineChange[];
        return {
          fields: [
            { label: 'فاکتور', value: `${inv.invoiceNo} — ${inv.contact.name}` },
            { label: 'وزن خالص تأییدشده', value: `${a.netWeightKg} کیلوگرم` },
            { label: 'تعدیل اقلام', value: changes.filter((c) => c.oldQty !== c.newQty).map((c) => `${c.description}: ${c.oldQty} ← ${c.newQty}`).join('\n') || '—' },
            { label: 'جمع قبل', value: `${a.oldTotal.toLocaleString('en-US')} تومان` },
            { label: 'جمع بعد', value: `${a.newTotal.toLocaleString('en-US')} تومان` },
          ],
        };
      },
    });
  }

  async latestFor(ctx: TenantRequestContext, shipmentId: string) {
    return ctx.tenantDb.dispatchInvoiceAdjustment.findFirst({ where: { shipmentId }, orderBy: { createdAt: 'desc' } });
  }

  /** پس از تأیید وزن نهایی: پیشنهاد تعدیل می‌سازد (و در صورت نبود تغییر، فاکتور را مستقیم نهایی می‌کند). */
  async propose(ctx: TenantRequestContext, shipmentId: string, actor: Actor) {
    const shipment = await ctx.tenantDb.shipment.findUnique({ where: { id: shipmentId }, include: { loading: true } });
    const loading = shipment?.loading;
    if (!shipment || !loading || !shipment.sourceInvoiceId || !loading.needsWeighing) return null;
    if (loading.netKg == null || !loading.weightConfirmedAt) throw new BadRequestException('ابتدا وزن نهایی باید تأیید شود');

    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: shipment.sourceInvoiceId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException('فاکتور مرتبط یافت نشد');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('فقط فاکتور پیش‌نویس قابل تعدیل است');

    const superseded = await ctx.tenantDb.dispatchInvoiceAdjustment.findMany({ where: { shipmentId, status: 'PROPOSED' }, select: { id: true } });
    for (const old of superseded) {
      await ctx.tenantDb.dispatchInvoiceAdjustment.update({ where: { id: old.id }, data: { status: 'REJECTED', decisionNote: 'با پیشنهاد جدید جایگزین شد', decidedAt: new Date() } });
      await this.approvals.closeForEntity(ctx, 'DISPATCH_ADJUSTMENT', old.id, 'REJECTED').catch(() => undefined);
    }

    // ردیف‌های ذخیره‌شده ممکن است با ویرایش پیش‌نویس تغییر شناسه داده باشند → اگر هیچ‌کدام نبود، همه‌ی ردیف‌ها
    const live = new Set(invoice.lines.map((l) => l.id));
    const weighLineIds = loading.weighLineIds.filter((id) => live.has(id));
    let result;
    try {
      result = proposeInvoiceAdjustment({
        lines: invoice.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        taxRate: invoice.isOfficial ? invoice.taxRate : null,
        netWeightKg: loading.netKg,
        weighLineIds,
        kgPerUnit: loading.kgPerUnit,
      });
    } catch (e) {
      if (e instanceof DispatchRuleError) throw new BadRequestException(e.message);
      throw e;
    }

    const adj = await ctx.tenantDb.dispatchInvoiceAdjustment.create({
      data: {
        invoiceId: invoice.id,
        shipmentId,
        status: result.changed ? 'PROPOSED' : 'NO_CHANGE',
        netWeightKg: loading.netKg,
        lineChanges: result.lineChanges as never,
        oldSubtotal: result.oldSubtotal,
        newSubtotal: result.newSubtotal,
        oldDiscount: result.oldDiscount,
        newDiscount: result.newDiscount,
        oldTaxAmount: result.oldTaxAmount,
        newTaxAmount: result.newTaxAmount,
        oldTotal: result.oldTotal,
        newTotal: result.newTotal,
        proposedByUserId: actor.userId,
        ...(result.changed ? {} : { decidedAt: new Date(), decidedByName: 'سیستم', decisionNote: 'وزن واقعی با اقلام فاکتور یکی است' }),
      },
    });
    await logEvent(ctx.tenantDb, shipmentId, {
      type: result.changed ? 'invoice_adjustment_proposed' : 'invoice_no_adjustment',
      actor,
      meta: { adjustmentId: adj.id, invoiceNo: invoice.invoiceNo, oldTotal: result.oldTotal, newTotal: result.newTotal },
    });

    if (result.changed) {
      await this.approvals
        .request(ctx, {
          moduleCode: 'sales',
          entityType: 'DISPATCH_ADJUSTMENT',
          entityId: adj.id,
          title: `تعدیل فاکتور ${invoice.invoiceNo} بر اساس وزن واقعی بار #${shipment.shipmentNo}`,
          summary: `${result.oldTotal.toLocaleString('en-US')} ← ${result.newTotal.toLocaleString('en-US')} تومان`,
          link: shipmentLink(shipmentId),
          requestedByUserId: actor.userId ?? undefined,
        })
        .catch(() => undefined);
    } else {
      await this.finalizeInvoice(ctx, adj.id, actor);
    }
    return ctx.tenantDb.dispatchInvoiceAdjustment.findUnique({ where: { id: adj.id } });
  }

  private async assertCanDecide(ctx: TenantRequestContext): Promise<void> {
    if (isManagerCtx(ctx)) return;
    const m = await this.permissions.getEffective(ctx, 'sales');
    if (!m.canEdit) throw new ForbiddenException('تأیید تعدیل فاکتور فقط برای مدیر یا حسابدار مجاز است');
  }

  async decide(ctx: TenantRequestContext, adjustmentId: string, approve: boolean, note?: string) {
    await this.assertCanDecide(ctx);
    const adj = await ctx.tenantDb.dispatchInvoiceAdjustment.findUnique({ where: { id: adjustmentId } });
    if (!adj) throw new NotFoundException('پیشنهاد تعدیل یافت نشد');
    if (adj.status !== 'PROPOSED') throw new BadRequestException('درباره‌ی این پیشنهاد قبلاً تصمیم گرفته شده است');
    const actor = await resolveActor(ctx);

    if (!approve) {
      await ctx.tenantDb.dispatchInvoiceAdjustment.update({
        where: { id: adj.id },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: actor.userId, decidedByName: actor.name, decisionNote: note ?? null },
      });
      await logEvent(ctx.tenantDb, adj.shipmentId, { type: 'invoice_adjustment_rejected', actor, note });
      await this.approvals.closeForEntity(ctx, 'DISPATCH_ADJUSTMENT', adj.id, 'REJECTED');
      return ctx.tenantDb.dispatchInvoiceAdjustment.findUnique({ where: { id: adj.id } });
    }

    await this.applyLines(ctx, adj);
    await ctx.tenantDb.dispatchInvoiceAdjustment.update({
      where: { id: adj.id },
      data: { status: 'APPLIED', decidedAt: new Date(), appliedAt: new Date(), decidedByUserId: actor.userId, decidedByName: actor.name, decisionNote: note ?? null },
    });
    await logEvent(ctx.tenantDb, adj.shipmentId, { type: 'invoice_adjustment_applied', actor, note, meta: { adjustmentId: adj.id } });
    await this.approvals.closeForEntity(ctx, 'DISPATCH_ADJUSTMENT', adj.id, 'APPROVED');
    await this.finalizeInvoice(ctx, adj.id, actor);
    return ctx.tenantDb.dispatchInvoiceAdjustment.findUnique({ where: { id: adj.id } });
  }

  private async applyLines(ctx: TenantRequestContext, adj: { invoiceId: string; lineChanges: unknown; newSubtotal: number; newDiscount: number; newTaxAmount: number; newTotal: number }) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: adj.invoiceId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException('فاکتور مرتبط یافت نشد');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('فاکتور دیگر پیش‌نویس نیست؛ تعدیل ممکن نیست');
    const changes = adj.lineChanges as LineChange[];
    for (const c of changes) {
      const line = invoice.lines.find((l) => l.id === c.lineId);
      if (!line || line.quantity !== c.oldQty || line.unitPrice !== c.unitPrice) {
        throw new BadRequestException('فاکتور پس از ثبت پیشنهاد ویرایش شده است؛ پیشنهاد تعدیل جدید ثبت کنید');
      }
    }
    await ctx.tenantDb.$transaction([
      ...changes
        .filter((c) => c.newQty !== c.oldQty)
        .map((c) => ctx.tenantDb.salesInvoiceLine.update({ where: { id: c.lineId }, data: { quantity: c.newQty, lineTotal: c.newTotal } })),
      ctx.tenantDb.salesInvoice.update({
        where: { id: invoice.id },
        data: { subtotal: adj.newSubtotal, discount: adj.newDiscount, taxAmount: adj.newTaxAmount, total: adj.newTotal },
      }),
    ]);
  }

  /** نهایی‌شدن خودکار با همان مسیر تأیید فاکتور (ثبت سند حسابداری + حواله انبار). شکست، تعدیل را نگه می‌دارد و هشدار می‌دهد. */
  async finalizeInvoice(ctx: TenantRequestContext, adjustmentId: string, actor: Actor): Promise<void> {
    const adj = await ctx.tenantDb.dispatchInvoiceAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
    try {
      await this.invoices.confirm(ctx, adj.invoiceId);
      await ctx.tenantDb.dispatchInvoiceAdjustment.update({ where: { id: adj.id }, data: { finalizedAt: new Date(), finalizeError: null } });
      await logEvent(ctx.tenantDb, adj.shipmentId, { type: 'invoice_finalized', actor: null, note: 'فاکتور پس از تأیید وزن، خودکار نهایی شد (در صورت نصب حسابداری، سند هم ثبت شد)' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.tenantDb.dispatchInvoiceAdjustment.update({ where: { id: adj.id }, data: { finalizeError: msg.slice(0, 500) } });
      await logEvent(ctx.tenantDb, adj.shipmentId, { type: 'invoice_finalize_failed', actor: null, note: msg.slice(0, 300) });
      if (actor.userId) {
        await this.notifications
          .notify(ctx.tenantDb, {
            userId: actor.userId,
            type: 'dispatch.invoice_finalize_failed',
            title: 'نهایی‌کردن خودکار فاکتور ناموفق بود',
            body: msg.slice(0, 200),
            link: shipmentLink(adj.shipmentId),
          })
          .catch(() => undefined);
      }
    }
  }

  /** تلاش دوباره‌ی نهایی‌کردن فاکتور برای تعدیل اعمال‌شده‌ای که نهایی نشد. */
  async retryFinalize(ctx: TenantRequestContext, shipmentId: string) {
    await this.assertCanDecide(ctx);
    const adj = await this.latestFor(ctx, shipmentId);
    if (!adj || (adj.status !== 'APPLIED' && adj.status !== 'NO_CHANGE')) throw new BadRequestException('تعدیل تأییدشده‌ای برای نهایی‌کردن وجود ندارد');
    if (adj.finalizedAt) throw new BadRequestException('فاکتور قبلاً نهایی شده است');
    await this.finalizeInvoice(ctx, adj.id, await resolveActor(ctx));
    return this.latestFor(ctx, shipmentId);
  }
}
