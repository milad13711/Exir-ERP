import { Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service.js';
import { BookStoreService } from '../book-store/book-store.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { publicRef } from '../common/tenant-public-key.js';
import { EbookDeliveryService } from '../book-store/ebook-delivery.service.js';
import { brandPage, ebookDeliveryBlock, esc, siteUrl } from './book-store-pages.js';

/** Unauthenticated payment flow for a book-store order — mirrors PublicEventsPaymentController exactly, scoped to a single order instead of an order group. */
@Controller('public/book/:slug/orders/:orderId')
export class PublicBookStorePaymentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gateway: PaymentGatewayService,
    private readonly bookStore: BookStoreService,
    private readonly ebook: EbookDeliveryService,
  ) {}

  /** صفحه‌ی موفقیت؛ برای نسخه‌ی الکترونیک لینک‌های دانلود امضاشده و کد مجوز را هم نشان می‌دهد. */
  private async successPage(ctx: TenantRequestContext, orderId: string): Promise<string> {
    const webUrl = siteUrl();
    const back = webUrl ? `<a class="btn alt" href="${esc(webUrl)}">بازگشت به سایت</a>` : '';
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    const links = order?.format === 'EBOOK' ? this.ebook.links(ctx, orderId) : null;
    if (!order || !links) {
      const note = order?.format === 'PRINT' ? 'سفارش شما ثبت شد و به‌زودی برای شما ارسال می‌شود.' : 'سفارش شما ثبت شد.';
      return brandPage(`<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>${note}</p>${back}`);
    }
    const ready = await this.ebook.isIssued(ctx, order);
    const failed = !ready && !!order.ebookError && !this.ebook.isIssuing(ctx, order.id);
    return brandPage(
      `<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>نسخه‌ی الکترونیک «سلطان قیف» آماده‌ی دریافت است.</p>${ebookDeliveryBlock({
        licenseCode: order.licenseCode,
        pdfUrl: links.pdfUrl,
        epubUrl: links.epubUrl,
        ready,
        failed,
      })}`,
      { refreshSeconds: ready || failed ? undefined : 10 },
    );
  }

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  @Post('pay')
  async pay(@Param('slug') slug: string, @Param('orderId') orderId: string) {
    const ctx = await this.resolveCtx(slug);
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.status !== 'PENDING_PAYMENT') return { error: 'این سفارش در انتظار پرداخت نیست' };

    if (!(await this.gateway.isConfigured(ctx))) return { error: 'درگاه پرداخت این کسب‌وکار هنوز تنظیم نشده است' };

    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.gateway.createPayment({
      ctx,
      amount: order.unitPrice,
      description: 'خرید کتاب سلطان قیف',
      callbackUrl: `${apiUrl}/public/book/${publicRef(slug)}/orders/${orderId}/callback`,
      mobile: order.buyerPhone,
    });
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };

    await ctx.tenantDb.bookOrder.update({ where: { id: orderId }, data: { zarinpalAuthority: result.authority } });
    return { paymentUrl: result.redirectUrl };
  }

  @Get('callback')
  async callback(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
    @Query('Authority') zarinpalAuthority: string | undefined,
    @Query('Status') status: string | undefined,
    @Query('id_get') bitpayIdGet: string | undefined,
    @Query('trans_id') bitpayTransId: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.resolveCtx(slug);

    const fail = async (message: string) => {
      await this.bookStore.cancelOrder(ctx, orderId);
      return res.send(brandPage(`<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>`));
    };

    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.paidAt) return res.send(await this.successPage(ctx, orderId));

    // زرین‌پال با Authority+Status برمی‌گردد، بیت‌پی با id_get+trans_id (و بدون Status).
    const authority = zarinpalAuthority ?? bitpayIdGet;
    if (!authority || (status !== undefined && status !== 'OK')) return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');
    if (order.zarinpalAuthority && order.zarinpalAuthority !== authority) return fail('اطلاعات تراکنش معتبر نیست.');

    const result = await this.gateway.verifyPayment({ ctx, authority, amount: order.unitPrice, transId: bitpayTransId });
    if (!result?.success) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    const refNumber = result.refId && /^\d+$/.test(result.refId) ? Number(result.refId) : null;
    if (refNumber !== null) await ctx.tenantDb.bookOrder.update({ where: { id: orderId }, data: { paymentRefId: refNumber } });
    await this.bookStore.finalizeOrderPayment(ctx, orderId);

    return res.send(await this.successPage(ctx, orderId));
  }
}
