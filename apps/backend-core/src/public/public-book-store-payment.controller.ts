import { Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service.js';
import { BookStoreService } from '../book-store/book-store.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { publicRef } from '../common/tenant-public-key.js';

const BRAND_PAGE_HEAD = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: Tahoma, sans-serif; background: #f6f2e9; color: #1a362e; display: flex;
    align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { background: #fff; border: 1px solid #e4e9e6; border-radius: 20px; padding: 40px 32px;
    max-width: 420px; text-align: center; box-shadow: 0 8px 30px -12px rgba(26,54,46,.15); }
  h1 { font-size: 18px; margin: 16px 0 8px; }
  p { font-size: 13.5px; color: #62766f; line-height: 1.9; margin: 0 0 20px; }
  a.btn { display: inline-block; background: #254c41; color: #fff; text-decoration: none;
    font-weight: bold; font-size: 13.5px; padding: 12px 28px; border-radius: 12px; }
  .icon { font-size: 40px; }
</style></head><body><div class="card">`;
const BRAND_PAGE_TAIL = `</div></body></html>`;

/** Unauthenticated payment flow for a book-store order — mirrors PublicEventsPaymentController exactly, scoped to a single order instead of an order group. */
@Controller('public/book/:slug/orders/:orderId')
export class PublicBookStorePaymentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gateway: PaymentGatewayService,
    private readonly bookStore: BookStoreService,
  ) {}

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
    const webUrl = (process.env.FUNNELKING_PUBLIC_URL ?? '').replace(/\/$/, '');

    const fail = async (message: string) => {
      await this.bookStore.cancelOrder(ctx, orderId);
      return res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>${BRAND_PAGE_TAIL}`);
    };

    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.status === 'PAID') {
      return res.send(
        `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>سفارش شما ثبت شد.</p>${
          webUrl ? `<a class="btn" href="${webUrl}">بازگشت به سایت</a>` : ''
        }${BRAND_PAGE_TAIL}`,
      );
    }

    // زرین‌پال با Authority+Status برمی‌گردد، بیت‌پی با id_get+trans_id (و بدون Status).
    const authority = zarinpalAuthority ?? bitpayIdGet;
    if (!authority || (status !== undefined && status !== 'OK')) return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');
    if (order.zarinpalAuthority && order.zarinpalAuthority !== authority) return fail('اطلاعات تراکنش معتبر نیست.');

    const result = await this.gateway.verifyPayment({ ctx, authority, amount: order.unitPrice, transId: bitpayTransId });
    if (!result?.success) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    const refNumber = result.refId && /^\d+$/.test(result.refId) ? Number(result.refId) : null;
    if (refNumber !== null) await ctx.tenantDb.bookOrder.update({ where: { id: orderId }, data: { paymentRefId: refNumber } });
    await this.bookStore.finalizeOrderPayment(ctx, orderId);

    return res.send(
      `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>سفارش شما ثبت شد و به‌زودی برای شما ارسال می‌شود.</p>${
        webUrl ? `<a class="btn" href="${webUrl}">بازگشت به سایت</a>` : ''
      }${BRAND_PAGE_TAIL}`,
    );
  }
}
