import { Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ZarinpalService } from '../billing/zarinpal.service.js';
import { InvoicesService, buildPaymentInstructionLine } from './invoices.service.js';
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
 * Unauthenticated customer-facing view + online payment of a sales invoice —
 * reached via a link sent by SMS from the invoice detail screen. Mirrors
 * PublicQuotationsController's slug+publicToken shape (security is the
 * unguessable token, the slug just picks the tenant DB), plus the
 * pay/callback pair from PublicBookingPaymentController/PublicEventsPaymentController.
 */
@Controller('public/tenants/:slug/invoices')
export class PublicSalesInvoiceController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly zarinpal: ZarinpalService,
    private readonly invoices: InvoicesService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  @Get(':token')
  async view(@Param('slug') slug: string, @Param('token') token: string) {
    const ctx = await this.resolveCtx(slug);
    const invoice = await ctx.tenantDb.salesInvoice.findFirst({
      where: { publicToken: token },
      include: {
        contact: { select: { name: true, company: true } },
        lines: { select: { description: true, quantity: true, unitPrice: true, lineTotal: true } },
        payments: { select: { amount: true, method: true, paidAt: true }, orderBy: { paidAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');

    return {
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      paidAmount: invoice.paidAmount,
      notes: invoice.notes,
      contact: invoice.contact,
      lines: invoice.lines,
      payments: invoice.payments,
      paymentMethod: invoice.paymentMethod,
      paymentBankInfo: invoice.paymentMethod === 'BANK_TRANSFER' ? invoice.paymentBankInfo : null,
      // راهنمای متنی پرداخت مخصوص روش انتخاب‌شده — فقط برای بانکی/چکی (برای آنلاین همین صفحه دکمه‌ی پرداخت دارد).
      paymentInstruction:
        invoice.paymentMethod !== 'ONLINE_GATEWAY' && invoice.total - invoice.paidAmount > 0
          ? buildPaymentInstructionLine(invoice, '') || null
          : null,
      // فقط وقتی صادرکننده «پرداخت آنلاین» را برای همین فاکتور انتخاب کرده — نه خودکار روی هر فاکتور تأییدشده.
      canPayOnline:
        invoice.paymentMethod === 'ONLINE_GATEWAY' &&
        (invoice.status === 'CONFIRMED' || invoice.status === 'PARTIALLY_PAID') &&
        invoice.paidAmount < invoice.total,
      gatewayAvailable: this.zarinpal.isConfigured,
    };
  }

  @Post(':token/pay')
  async pay(@Param('slug') slug: string, @Param('token') token: string) {
    const ctx = await this.resolveCtx(slug);
    const invoice = await ctx.tenantDb.salesInvoice.findFirst({ where: { publicToken: token } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');

    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.invoices.initiateGatewayPayment(
      ctx,
      invoice.id,
      `${apiUrl}/public/tenants/${slug}/invoices/${token}/callback`,
    );
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };
    return { paymentUrl: result.paymentUrl };
  }

  @Get(':token/callback')
  async callback(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Query('Authority') authority: string | undefined,
    @Query('Status') status: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.resolveCtx(slug);
    const webUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    const backLink = webUrl ? `<a class="btn" href="${webUrl}/invoice/${publicRef(slug)}/${token}">بازگشت به فاکتور</a>` : '';

    const invoice = await ctx.tenantDb.salesInvoice.findFirst({ where: { publicToken: token } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    if (invoice.status === 'PAID') {
      return res.send(`${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>فاکتور تسویه شده است.</p>${backLink}${BRAND_PAGE_TAIL}`);
    }

    if (status !== 'OK' || !authority) {
      return res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.</p>${backLink}${BRAND_PAGE_TAIL}`);
    }

    const result = await this.invoices.verifyGatewayPayment(ctx, invoice.id, authority);
    if (!result.success) {
      return res.send(`${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>تأیید تراکنش با درگاه پرداخت ناموفق بود.</p>${backLink}${BRAND_PAGE_TAIL}`);
    }

    return res.send(`${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>رسید برای شما ثبت شد.</p>${backLink}${BRAND_PAGE_TAIL}`);
  }
}
