import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { InvoicesService } from '../sales/invoices.service.js';

/**
 * فروش تک‌محصولی — صفحه‌ی فروش یک محصول با چند نسخه (مثلاً چاپی/الکترونیکی/
 * صوتی کتاب). الگوبرداری از EventsService.createOrder/finalizeOrderPayment،
 * بدون ظرفیت/QR که مخصوص بلیط بود. قیمت هر نسخه اینجا ثابت است — چون این
 * ماژول برای یک محصول پرچم‌دار مشخص نصب می‌شود، نه یک کاتالوگ چندمحصولی
 * (آن نقش را online-store پوشش می‌دهد).
 */
export const BOOK_ORDER_FORMATS = {
  PRINT: { unitPrice: 1_400_000, needsShipping: true, label: 'نسخه‌ی چاپی' },
  EBOOK: { unitPrice: 650_000, needsShipping: false, label: 'نسخه‌ی الکترونیکی' },
  AUDIO: { unitPrice: 850_000, needsShipping: false, label: 'نسخه‌ی صوتی' },
} as const;

export type BookOrderFormatCode = keyof typeof BOOK_ORDER_FORMATS;

export interface CreateBookOrderInput {
  format: BookOrderFormatCode;
  buyerName: string;
  buyerPhone: string;
  address?: string;
  postalCode?: string;
}

@Injectable()
export class BookStoreService {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly sms: TenantSmsService,
    private readonly invoices: InvoicesService,
  ) {}

  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.bookOrder.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createOrder(ctx: TenantRequestContext, input: CreateBookOrderInput) {
    const format = BOOK_ORDER_FORMATS[input.format];
    if (!format) throw new NotFoundException('این نسخه از محصول یافت نشد');
    if (format.needsShipping && (!input.address?.trim() || !input.postalCode?.trim())) {
      throw new ConflictException('برای نسخه‌ی چاپی، آدرس و کد پستی لازم است');
    }

    return ctx.tenantDb.bookOrder.create({
      data: {
        format: input.format,
        buyerName: input.buyerName,
        buyerPhone: input.buyerPhone,
        address: format.needsShipping ? input.address : undefined,
        postalCode: format.needsShipping ? input.postalCode : undefined,
        unitPrice: format.unitPrice,
      },
    });
  }

  private async resolveOrCreateContact(ctx: TenantRequestContext, name: string, phone: string) {
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
    if (existing) return existing;
    return ctx.tenantDb.crmContact.create({ data: { name, phone, isCustomer: true, source: 'فروشگاه کتاب' } });
  }

  /** پرداخت موفق شد — مخاطب پیدا/ساخته می‌شود، فاکتور صادر می‌شود، و پیامک تأیید ارسال می‌شود. Idempotent. */
  async finalizeOrderPayment(ctx: TenantRequestContext, orderId: string) {
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.paidAt) return order; // قبلاً نهایی شده — idempotent

    const contact = await this.resolveOrCreateContact(ctx, order.buyerName, order.buyerPhone);
    const format = BOOK_ORDER_FORMATS[order.format as BookOrderFormatCode];
    const invoice = await this.invoices.create(ctx, {
      contactId: contact.id,
      notes: `خرید کتاب سلطان قیف — ${format.label}`,
      lines: [{ description: `کتاب سلطان قیف — ${format.label}`, quantity: 1, unitPrice: order.unitPrice }],
    });

    const updated = await ctx.tenantDb.bookOrder.update({
      where: { id: orderId },
      data: { status: 'PAID', paidAt: new Date(), contactId: contact.id, invoiceId: invoice.id },
    });

    const deliveryNote = format.needsShipping
      ? 'سفارش شما ثبت شد و به‌زودی ارسال می‌شود.'
      : `${format.label} خریداری‌شده به‌زودی برای شما ارسال می‌شود.`;
    await this.sms.sendSms(ctx, order.buyerPhone, `خرید کتاب سلطان قیف با موفقیت انجام شد. ${deliveryNote}`);
    await this.automation.emit(ctx, 'book-store.order.paid', { format: order.format, buyerName: order.buyerName });

    return updated;
  }

  async cancelOrder(ctx: TenantRequestContext, orderId: string) {
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order || order.status !== 'PENDING_PAYMENT') return;
    await ctx.tenantDb.bookOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
  }

  async markShipped(ctx: TenantRequestContext, orderId: string) {
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.status !== 'PAID') throw new ConflictException('فقط سفارش پرداخت‌شده قابل ارسال است');
    return ctx.tenantDb.bookOrder.update({ where: { id: orderId }, data: { status: 'SHIPPED' } });
  }
}
