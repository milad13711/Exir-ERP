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

/** Unauthenticated payment flow for an event ticket booking — mirrors PublicBookingPaymentController exactly, scoped to an EventBooking instead of an Appointment deposit. */
@Controller('public/events/:slug/bookings/:id')
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
  async pay(@Param('slug') slug: string, @Param('id') id: string) {
    const ctx = await this.resolveCtx(slug);
    const booking = await ctx.tenantDb.eventBooking.findUnique({ where: { id }, include: { event: true } });
    if (!booking) throw new NotFoundException('این رزرو یافت نشد');
    if (booking.status !== 'PENDING_PAYMENT') return { error: 'این رزرو در انتظار پرداخت نیست' };

    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.zarinpal.requestPayment({
      amountToman: booking.totalAmount,
      description: `بلیط رویداد «${booking.event.title}»`,
      callbackUrl: `${apiUrl}/public/events/${slug}/bookings/${id}/callback`,
      mobile: booking.buyerPhone,
    });
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };

    await ctx.tenantDb.eventBooking.update({ where: { id }, data: { zarinpalAuthority: result.authority } });
    return { paymentUrl: result.paymentUrl };
  }

  @Get('callback')
  async callback(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Query('Authority') authority: string | undefined,
    @Query('Status') status: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.resolveCtx(slug);
    const webUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

    const fail = async (message: string) => {
      await this.events.cancelBooking(ctx, id); // ظرفیت نگه‌داشته‌شده آزاد می‌شود
      return res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>${BRAND_PAGE_TAIL}`);
    };

    const booking = await ctx.tenantDb.eventBooking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('این رزرو یافت نشد');
    if (booking.status === 'PAID') {
      return res.send(
        `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>بلیط شما پیامک شد.</p>${
          webUrl ? `<a class="btn" href="${webUrl}/events/${slug}/bookings/${id}">مشاهده بلیط</a>` : ''
        }${BRAND_PAGE_TAIL}`,
      );
    }

    if (status !== 'OK' || !authority) return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');
    if (booking.zarinpalAuthority && booking.zarinpalAuthority !== authority) return fail('اطلاعات تراکنش معتبر نیست.');

    const result = await this.zarinpal.verifyPayment({ amountToman: booking.totalAmount, authority });
    if (!result.success) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    await ctx.tenantDb.eventBooking.update({ where: { id }, data: { paymentRefId: result.refId } });
    await this.events.finalizeBookingPayment(ctx, id, webUrl);

    return res.send(
      `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>بلیط شما صادر و پیامک شد.</p>${
        webUrl ? `<a class="btn" href="${webUrl}/events/${slug}/bookings/${id}">مشاهده بلیط</a>` : ''
      }${BRAND_PAGE_TAIL}`,
    );
  }
}
