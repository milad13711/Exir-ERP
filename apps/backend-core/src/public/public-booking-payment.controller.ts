import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ProviderRejectDto, ProviderRescheduleDto } from './dto/provider-actions.dto.js';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AppointmentsService } from '../booking/appointments.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { publicRef } from '../common/tenant-public-key.js';

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
 * Unauthenticated payment flow for an appointment's deposit — reached from
 * the SMS sent right after booking (or after coordination approval) for any
 * ServiceType.requiresDeposit service. Mirrors PublicInvoicePaymentController
 * exactly, just scoped to one tenant's appointment instead of a control-plane
 * Invoice, and delegates the actual gateway calls to AppointmentsService so
 * the Zarinpal amount/authority bookkeeping lives in one place.
 */
@Controller('public/booking/:slug/appointments/:id')
export class PublicBookingPaymentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly appointments: AppointmentsService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  @Get()
  async view(@Param('slug') slug: string, @Param('id') id: string) {
    const ctx = await this.resolveCtx(slug);
    const appointment = await ctx.tenantDb.appointment.findUnique({
      where: { id },
      include: { serviceType: true },
    });
    if (!appointment) throw new NotFoundException('نوبت یافت نشد');
    return {
      id: appointment.id,
      serviceName: appointment.serviceType.name,
      customerName: appointment.customerName,
      startAt: appointment.startAt,
      depositAmount: appointment.depositAmount,
      paymentStatus: appointment.paymentStatus,
    };
  }

  @Post('pay')
  async pay(@Param('slug') slug: string, @Param('id') id: string) {
    const ctx = await this.resolveCtx(slug);
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.appointments.initiateDepositPayment(
      ctx,
      id,
      `${apiUrl}/public/booking/${slug}/appointments/${id}/callback`,
    );
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };
    if ('error' in result) return { error: result.error };
    return { paymentUrl: result.paymentUrl };
  }

  @Get('callback')
  async callback(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Query('Authority') zarinpalAuthority: string | undefined,
    @Query('Status') status: string | undefined,
    @Query('id_get') bitpayIdGet: string | undefined,
    @Query('trans_id') bitpayTransId: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.resolveCtx(slug);
    const bookingUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

    const fail = (message: string) =>
      res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>${BRAND_PAGE_TAIL}`);

    // زرین‌پال با Authority+Status برمی‌گردد، بیت‌پی با id_get+trans_id (و بدون Status).
    const authority = zarinpalAuthority ?? bitpayIdGet;
    if (!authority || (status !== undefined && status !== 'OK')) return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');

    const result = await this.appointments.verifyDepositPayment(ctx, id, authority, bitpayTransId);
    if (!result.success) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    // رسید و تأیید رزرو روی صفحه‌ی عمومی جزئیات جلسه نمایش داده می‌شود
    if (bookingUrl) return res.redirect(`${bookingUrl}/book/${publicRef(slug)}/a/${result.appointment.publicToken}?paid=1`);
    return res.send(`${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>رزرو شما نهایی شد. رسید برای شما پیامک شد.</p>${BRAND_PAGE_TAIL}`);
  }
}

/** صفحه‌ی عمومی «توضیحات جلسه» با publicToken — لینکی که داخل پیامک رزرو می‌رود. */
@Controller('public/booking/:slug/a/:token')
export class PublicBookingAppointmentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly appointments: AppointmentsService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  @Get()
  async view(@Param('slug') slug: string, @Param('token') token: string) {
    const ctx = await this.resolveCtx(slug);
    const [appointment, tenant] = await Promise.all([
      this.appointments.publicView(ctx, token),
      this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }),
    ]);
    return { ...appointment, businessName: tenant?.name ?? '' };
  }

  @Post('pay')
  async pay(@Param('slug') slug: string, @Param('token') token: string) {
    const ctx = await this.resolveCtx(slug);
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.appointments.initiatePaymentByToken(ctx, token, `${apiUrl}/public/booking/${slug}`);
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };
    if ('error' in result) return { error: result.error };
    return { paymentUrl: result.paymentUrl };
  }
}

/** لینک خصوصی متخصص: مشاهده‌ی متقاضی، تأیید، رد با دلیل، جابه‌جایی به وقت آزاد. */
@Controller('public/booking/:slug/s/:token')
export class PublicBookingProviderController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly appointments: AppointmentsService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  @Get()
  async view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.appointments.providerView(await this.resolveCtx(slug), token);
  }

  @Get('slots')
  async slots(@Param('slug') slug: string, @Param('token') token: string, @Query('date') date: string) {
    return this.appointments.providerSlots(await this.resolveCtx(slug), token, date);
  }

  @Post('confirm')
  async confirm(@Param('slug') slug: string, @Param('token') token: string) {
    return this.appointments.providerConfirm(await this.resolveCtx(slug), token);
  }

  @Post('reject')
  async reject(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: ProviderRejectDto) {
    return this.appointments.providerReject(await this.resolveCtx(slug), token, dto.reason);
  }

  @Post('reschedule')
  async reschedule(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: ProviderRescheduleDto) {
    return this.appointments.providerReschedule(await this.resolveCtx(slug), token, dto.startAt);
  }
}
