import { Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ZarinpalService } from '../billing/zarinpal.service.js';
import { EventsService } from '../events/events.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const BRAND_PAGE_HEAD = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: Tahoma, sans-serif; background: #f8fafc; color: #0f172a; display: flex;
    align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 40px 32px;
    max-width: 420px; text-align: center; box-shadow: 0 8px 30px -12px rgba(15,23,42,.15); }
  h1 { font-size: 18px; margin: 16px 0 8px; }
  p { font-size: 13.5px; color: #475569; line-height: 1.9; margin: 0 0 20px; }
  a.btn { display: inline-block; background: #4338ca; color: #fff; text-decoration: none;
    font-weight: bold; font-size: 13.5px; padding: 12px 28px; border-radius: 12px; }
  .icon { font-size: 40px; }
</style></head><body><div class="card">`;
const BRAND_PAGE_TAIL = `</div></body></html>`;

/**
 * Unauthenticated payment flow for an event ticket order — mirrors
 * PublicBookingPaymentController, scoped to a whole order (orderGroupId,
 * one or more EventBooking rows — one per ticket type in the same purchase)
 * rather than a single Appointment deposit, since one order can cover
 * multiple ticket types with a single Zarinpal transaction.
 */
@Controller('public/events/:slug/bookings/:orderGroupId')
export class PublicEventsPaymentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly zarinpal: ZarinpalService,
    private readonly events: EventsService,
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
  async pay(@Param('slug') slug: string, @Param('orderGroupId') orderGroupId: string) {
    const ctx = await this.resolveCtx(slug);
    const bookings = await ctx.tenantDb.eventBooking.findMany({ where: { orderGroupId }, include: { event: true } });
    if (bookings.length === 0) throw new NotFoundException('این سفارش یافت نشد');
    if (bookings[0].status !== 'PENDING_PAYMENT') return { error: 'این سفارش در انتظار پرداخت نیست' };

    const totalAmount = bookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.zarinpal.requestPayment({
      amountToman: totalAmount,
      description: `بلیط رویداد «${bookings[0].event.title}»`,
      callbackUrl: `${apiUrl}/public/events/${slug}/bookings/${orderGroupId}/callback`,
      mobile: bookings[0].buyerPhone,
    });
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };

    await ctx.tenantDb.eventBooking.updateMany({ where: { orderGroupId }, data: { zarinpalAuthority: result.authority } });
    return { paymentUrl: result.paymentUrl };
  }

  @Get('callback')
  async callback(
    @Param('slug') slug: string,
    @Param('orderGroupId') orderGroupId: string,
    @Query('Authority') authority: string | undefined,
    @Query('Status') status: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.resolveCtx(slug);
    const webUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

    const fail = async (message: string) => {
      await this.events.cancelOrder(ctx, orderGroupId); // ظرفیت نگه‌داشته‌شده آزاد می‌شود
      return res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>${BRAND_PAGE_TAIL}`);
    };

    const bookings = await ctx.tenantDb.eventBooking.findMany({ where: { orderGroupId } });
    if (bookings.length === 0) throw new NotFoundException('این سفارش یافت نشد');
    if (bookings[0].status === 'PAID') {
      return res.send(
        `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>بلیط شما پیامک شد.</p>${
          webUrl ? `<a class="btn" href="${webUrl}/events/${slug}/bookings/${orderGroupId}">مشاهده بلیط</a>` : ''
        }${BRAND_PAGE_TAIL}`,
      );
    }

    if (status !== 'OK' || !authority) return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');
    if (bookings[0].zarinpalAuthority && bookings[0].zarinpalAuthority !== authority) return fail('اطلاعات تراکنش معتبر نیست.');

    const totalAmount = bookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const result = await this.zarinpal.verifyPayment({ amountToman: totalAmount, authority });
    if (!result.success) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    await ctx.tenantDb.eventBooking.updateMany({ where: { orderGroupId }, data: { paymentRefId: result.refId } });
    await this.events.finalizeOrderPayment(ctx, orderGroupId, webUrl);

    return res.send(
      `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>بلیط شما صادر و پیامک شد.</p>${
        webUrl ? `<a class="btn" href="${webUrl}/events/${slug}/bookings/${orderGroupId}">مشاهده بلیط</a>` : ''
      }${BRAND_PAGE_TAIL}`,
    );
  }
}
