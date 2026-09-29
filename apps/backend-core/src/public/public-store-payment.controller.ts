import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ZarinpalService } from '../billing/zarinpal.service.js';
import { StoreOrdersService } from '../online-store/store-orders.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { StoreOrderTicketPayload } from '../auth/jwt-payload.type.js';
import { publicRef } from '../common/tenant-public-key.js';
import { PayStoreOrderDto } from './dto/pay-store-order.dto.js';

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

/**
 * Unauthenticated online-payment (Zarinpal) path for an online-store order —
 * ported from PublicBookStorePaymentController, adapted from a single-SKU
 * order to a StoreOrder that may already exist in the (default) cash/pay-later
 * flow. Requires an OTP-verified orderToken (PublicStoreService.verifyOtp) so
 * a payment can't be started for an order under a phone number the caller
 * doesn't actually control.
 */
@Controller('public/store/:slug/orders/:orderId')
export class PublicStorePaymentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly zarinpal: ZarinpalService,
    private readonly storeOrders: StoreOrdersService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  private async resolveOrderPhone(slug: string, orderToken: string): Promise<string> {
    let payload: StoreOrderTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<StoreOrderTicketPayload>(orderToken);
    } catch {
      throw new UnauthorizedException('نشست پرداخت منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'store_order_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست پرداخت نامعتبر است');
    }
    return payload.phone;
  }

  @Post('pay')
  async pay(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
    @Body() dto: PayStoreOrderDto,
  ) {
    const ctx = await this.resolveCtx(slug);
    const order = await ctx.tenantDb.storeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.paidAt) return { error: 'این سفارش قبلاً پرداخت شده است' };

    const verifiedPhone = await this.resolveOrderPhone(slug, dto.orderToken);
    if (verifiedPhone !== order.customerPhone) {
      throw new UnauthorizedException('این نشست پرداخت متعلق به این سفارش نیست');
    }

    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.zarinpal.requestPayment({
      amountToman: order.subtotal,
      description: `خرید از فروشگاه آنلاین — سفارش #${order.orderNo}`,
      callbackUrl: `${apiUrl}/public/store/${publicRef(slug)}/orders/${orderId}/callback`,
      mobile: order.customerPhone,
    });
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };

    await ctx.tenantDb.storeOrder.update({ where: { id: orderId }, data: { zarinpalAuthority: result.authority } });
    return { paymentUrl: result.paymentUrl };
  }

  @Get('callback')
  async callback(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
    @Query('Authority') authority: string | undefined,
    @Query('Status') status: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.resolveCtx(slug);

    const fail = (message: string) =>
      res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>${BRAND_PAGE_TAIL}`);

    const order = await ctx.tenantDb.storeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    if (order.paidAt) {
      return res.send(
        `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>سفارش شما ثبت شد.</p>${BRAND_PAGE_TAIL}`,
      );
    }

    // برخلاف BookOrder، سفارش فروشگاه پیش از پرداخت هم یک وضعیت معتبر دارد
    // (PENDING) — پس شکست پرداخت اینجا سفارش را لغو نمی‌کند، فقط پیام خطا
    // نشان می‌دهد؛ خریدار می‌تواند دوباره تلاش کند یا تننت دستی پیگیری کند.
    if (status !== 'OK' || !authority) return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');
    if (order.zarinpalAuthority && order.zarinpalAuthority !== authority) return fail('اطلاعات تراکنش معتبر نیست.');

    const result = await this.zarinpal.verifyPayment({ amountToman: order.subtotal, authority });
    if (!result.success || !result.refId) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    await this.storeOrders.finalizeOnlinePayment(ctx, orderId, result.refId);

    return res.send(
      `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>سفارش شما ثبت و تأیید شد.</p>${BRAND_PAGE_TAIL}`,
    );
  }
}
