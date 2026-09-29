import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { InvoicesService } from '../sales/invoices.service.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { BookStoreSettingsService, type BookStoreSettings } from './book-store-settings.service.js';

/**
 * فروش تک‌محصولی — صفحه‌ی فروش یک محصول با چند نسخه (مثلاً چاپی/الکترونیکی/
 * صوتی کتاب). الگوبرداری از EventsService.createOrder/finalizeOrderPayment،
 * بدون ظرفیت/QR که مخصوص بلیط بود. این ماژول برای یک محصول پرچم‌دار مشخص
 * نصب می‌شود، نه یک کاتالوگ چندمحصولی (آن نقش را online-store پوشش می‌دهد).
 *
 * قیمت هر نسخه از BookStoreSettingsService خوانده می‌شود (قابل‌تنظیم توسط
 * تننت)؛ فقط شکل ساختاری هر نسخه (نیاز به آدرس/کد پستی، برچسب فارسی) اینجا
 * ثابت است چون بخشی از منطق دامنه است، نه قیمت‌گذاری.
 */
export const BOOK_ORDER_FORMAT_META = {
  PRINT: { needsShipping: true, label: 'نسخه‌ی چاپی' },
  EBOOK: { needsShipping: false, label: 'نسخه‌ی الکترونیکی' },
  AUDIO: { needsShipping: false, label: 'نسخه‌ی صوتی' },
} as const;

export type BookOrderFormatCode = keyof typeof BOOK_ORDER_FORMAT_META;

function priceFor(settings: BookStoreSettings, format: BookOrderFormatCode): number {
  if (format === 'PRINT') return settings.printPriceToman;
  if (format === 'EBOOK') return settings.ebookPriceToman;
  return settings.audioPriceToman;
}

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
    private readonly settings: BookStoreSettingsService,
  ) {}

  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.bookOrder.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getSettings(ctx: TenantRequestContext) {
    return this.settings.get(ctx);
  }

  async updateSettings(ctx: TenantRequestContext, dto: Partial<BookStoreSettings>) {
    return this.settings.update(ctx, dto);
  }

  /** فرمت‌های قابل خرید همراه با قیمت فعلی تننت — برای کاتالوگ عمومی و پنل مدیریت. */
  async getFormats(ctx: TenantRequestContext) {
    const settings = await this.settings.get(ctx);
    return Object.entries(BOOK_ORDER_FORMAT_META).map(([format, meta]) => ({
      format: format as BookOrderFormatCode,
      ...meta,
      unitPrice: priceFor(settings, format as BookOrderFormatCode),
    }));
  }

  async createOrder(ctx: TenantRequestContext, input: CreateBookOrderInput) {
    const meta = BOOK_ORDER_FORMAT_META[input.format];
    if (!meta) throw new NotFoundException('این نسخه از محصول یافت نشد');
    if (meta.needsShipping && (!input.address?.trim() || !input.postalCode?.trim())) {
      throw new ConflictException('برای نسخه‌ی چاپی، آدرس و کد پستی لازم است');
    }
    const settings = await this.settings.get(ctx);

    return ctx.tenantDb.bookOrder.create({
      data: {
        format: input.format,
        buyerName: input.buyerName,
        buyerPhone: input.buyerPhone,
        address: meta.needsShipping ? input.address : undefined,
        postalCode: meta.needsShipping ? input.postalCode : undefined,
        unitPrice: priceFor(settings, input.format),
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
    const format = BOOK_ORDER_FORMAT_META[order.format as BookOrderFormatCode];
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

  /**
   * ارسال سفارش چاپی — اگر نسخه‌ی چاپی به یک کالای انبار متصل شده باشد
   * (BookStoreSettings.printProductId)، یک StockMovement واقعی از نوع ISSUE
   * ثبت می‌شود تا موجودی انبار واقعاً کم شود؛ دقیقاً همان الگوی
   * StoreOrdersService.updateStatus برای وضعیت SHIPPED. اگر کالایی متصل
   * نشده باشد (پیش‌فرض)، ارسال فقط وضعیت سفارش را تغییر می‌دهد — بدون اثر
   * روی انبار — چون این پیوند صراحتاً باید توسط مدیر تننت تنظیم شود.
   */
  async markShipped(ctx: TenantRequestContext, orderId: string) {
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.status !== 'PAID') throw new ConflictException('فقط سفارش پرداخت‌شده قابل ارسال است');

    const settings = order.format === 'PRINT' ? await this.settings.get(ctx) : null;
    const printProductId = settings?.printProductId ?? null;
    // خارج از تراکنش گرفته می‌شود چون ensureDefaultWarehouse با کلاینت کامل
    // Prisma کار می‌کند، نه با TransactionClient محدودشده‌ی $transaction (نک: StoreOrdersService.updateStatus).
    const warehouse = printProductId ? await ensureDefaultWarehouse(ctx.tenantDb) : null;

    return ctx.tenantDb.$transaction(async (tx) => {
      const updated = await tx.bookOrder.update({ where: { id: orderId }, data: { status: 'SHIPPED' } });
      if (printProductId && warehouse) {
        await tx.stockMovement.create({
          data: {
            productId: printProductId,
            warehouseId: warehouse.id,
            type: 'ISSUE',
            quantityDelta: -1,
            reference: `سفارش کتاب #${order.orderNo}`,
          },
        });
      }
      return updated;
    });
  }
}
