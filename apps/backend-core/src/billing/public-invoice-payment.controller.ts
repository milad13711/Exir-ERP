import { Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ZarinpalService } from './zarinpal.service.js';

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
 * Unauthenticated payment flow for a control-plane Invoice — reached either
 * via a link staff hands a PENDING_PAYMENT tenant (who can't log in yet to
 * see it any other way), or called by an already-logged-in tenant's own
 * billing page for a module-purchase invoice. No ownership check on purpose:
 * an invoice id is an unguessable UUID, and paying someone else's invoice
 * FOR them isn't a security problem — that's what a payment link is for.
 */
@Controller('public/invoices')
export class PublicInvoicePaymentController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenants: TenantsService,
    private readonly zarinpal: ZarinpalService,
  ) {}

  @Get(':id')
  async view(@Param('id') id: string) {
    const invoice = await this.controlDb.invoice.findUnique({
      where: { id },
      include: { tenant: { select: { name: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    return {
      id: invoice.id,
      amount: invoice.amount,
      status: invoice.status,
      dueAt: invoice.dueAt,
      tenantName: invoice.tenant.name,
      items: invoice.items as { moduleCode: string; moduleName: string; billingMode: string; amount: number }[] | null,
      gatewayAvailable: this.zarinpal.isConfigured,
    };
  }

  @Post(':id/pay')
  async pay(@Param('id') id: string) {
    const invoice = await this.controlDb.invoice.findUnique({ where: { id }, include: { tenant: true } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    if (invoice.status !== 'PENDING') {
      return { error: invoice.status === 'PAID' ? 'این فاکتور قبلاً پرداخت شده است' : 'این فاکتور قابل پرداخت نیست' };
    }

    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const result = await this.zarinpal.requestPayment({
      amountToman: invoice.amount,
      description: `فاکتور ${invoice.tenant.name} — اکسیر ERP`,
      callbackUrl: `${apiUrl}/public/invoices/${id}/callback`,
      merchantId: invoice.purpose === 'SMS_PACKAGE' ? process.env.SMS_ZARINPAL_MERCHANT_ID : undefined,
    });
    if (!result) return { error: 'درگاه پرداخت در دسترس نیست، لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید' };

    await this.controlDb.invoice.update({ where: { id }, data: { zarinpalAuthority: result.authority } });
    return { paymentUrl: result.paymentUrl };
  }

  @Get(':id/callback')
  async callback(
    @Param('id') id: string,
    @Query('Authority') authority: string | undefined,
    @Query('Status') status: string | undefined,
    @Res() res: Response,
  ) {
    const invoice = await this.controlDb.invoice.findUnique({ where: { id } });
    const loginUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

    const fail = (message: string) =>
      res.send(
        `${BRAND_PAGE_HEAD}<div class="icon">❌</div><h1>پرداخت ناموفق بود</h1><p>${message}</p>${BRAND_PAGE_TAIL}`,
      );

    if (!invoice) return fail('فاکتور یافت نشد.');
    if (invoice.status === 'PAID') {
      return res.send(
        `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>این فاکتور قبلاً پرداخت شده است</h1><p>می‌توانید وارد حساب کاربری خود شوید.</p>${
          loginUrl ? `<a class="btn" href="${loginUrl}">ورود به اکسیر ERP</a>` : ''
        }${BRAND_PAGE_TAIL}`,
      );
    }
    if (status !== 'OK' || !authority || authority !== invoice.zarinpalAuthority) {
      return fail('پرداخت توسط شما لغو شد یا تراکنش نامعتبر بود.');
    }

    const verified = await this.zarinpal.verifyPayment({
      amountToman: invoice.amount,
      authority,
      merchantId: invoice.purpose === 'SMS_PACKAGE' ? process.env.SMS_ZARINPAL_MERCHANT_ID : undefined,
    });
    if (!verified.success) return fail('تأیید تراکنش با درگاه پرداخت ناموفق بود.');

    await this.tenants.markInvoicePaidByGateway(id, verified.refId!);

    const isModuleInvoice = invoice.purpose === 'MODULE_PURCHASE' || invoice.purpose === 'MODULE_RENEWAL';
    const bodyText =
      invoice.purpose === 'SMS_PACKAGE'
        ? `بسته‌ی پیامکی شما همین حالا شارژ شد. کد پیگیری: ${verified.refId}`
        : isModuleInvoice
        ? `ماژول‌های خریداری‌شده فعال شدند. برای دیدن تغییرات، صفحه‌ی فروشگاه ماژول را در پنل خود رفرش کنید. کد پیگیری: ${verified.refId}`
        : `محیط کاری شما اکنون فعال است. کد پیگیری: ${verified.refId}`;

    return res.send(
      `${BRAND_PAGE_HEAD}<div class="icon">✅</div><h1>پرداخت با موفقیت انجام شد</h1><p>${bodyText}</p>${
        loginUrl ? `<a class="btn" href="${loginUrl}">ورود به اکسیر ERP</a>` : ''
      }${BRAND_PAGE_TAIL}`,
    );
  }
}
