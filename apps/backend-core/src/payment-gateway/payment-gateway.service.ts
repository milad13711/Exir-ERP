import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { PaymentGatewaySettingsService, type GatewayProvider } from './payment-gateway-settings.service.js';
import { ZarinpalGatewayProvider } from './providers/zarinpal.provider.js';
import { BitpayGatewayProvider } from './providers/bitpay.provider.js';
import { HttpException } from '@nestjs/common';
import { loadBaseCurrency, toGatewayToman } from '../base-currency/base-unit.js';
import { isConversionActive } from '../base-currency/conversion-gate.js';

const CONVERTING_MSG = 'تغییر ارز پایه در حال انجام است؛ پرداخت/تأیید پرداخت موقتاً متوقف است. چند دقیقه دیگر دوباره تلاش کنید (پرداخت شما در درگاه از بین نمی‌رود).';

export type CreatePaymentInput = {
  ctx: TenantRequestContext;
  /** به واحد ارز پایه‌ی تننت (تومان یا ریال...)؛ همین‌جا به تومان درگاه تبدیل می‌شود. */
  amount: number;
  description: string;
  callbackUrl: string;
  mobile?: string;
  email?: string;
};

export type CreatePaymentResult = { redirectUrl: string; authority: string; provider: GatewayProvider };

export type VerifyPaymentInput = {
  ctx: TenantRequestContext;
  authority: string;
  /** واحد ارز پایه — باید با مبلغ زمان create برابر باشد (تبدیل به تومان درگاه همین‌جا). */
  amount: number;
  /** فقط بیت‌پی: اگر callback بیت‌پی trans_id جداگانه داد، اینجا پاس داده شود؛ برای زرین‌پال بی‌اثر است. */
  transId?: string;
};

export type VerifyPaymentResult = { success: boolean; refId?: string; provider: GatewayProvider };

/**
 * لایه‌ی عمومیِ «هر ماژولی که می‌خواهد پول بگیرد» — پرداخت واقعی را بر اساس
 * درگاه فعالِ همین تننت (تنظیم‌شده در صفحه‌ی تنظیمات ماژول «درگاه پرداخت»)
 * به پیاده‌سازی درست می‌فرستد. برخلاف apps/backend-core/src/billing/zarinpal.service.ts
 * (که مرچنت خودِ اکسیر برای خرید ماژول از کاتالوگ را دارد)، این سرویس همیشه
 * مرچنت/کلید اختصاصیِ همان تننت را می‌خواند — هیچ fallback به env متغیرهای
 * پلتفرم ندارد.
 */
@Injectable()
export class PaymentGatewayService {
  constructor(
    private readonly settings: PaymentGatewaySettingsService,
    private readonly zarinpal: ZarinpalGatewayProvider,
    private readonly bitpay: BitpayGatewayProvider,
  ) {}

  /** آیا این تننت یک درگاه فعال با اعتبارنامه‌ی کامل دارد؟ (برای نمایش/مسدودکردن گزینه‌ی «پرداخت آنلاین» در ماژول‌ها) */
  async isConfigured(ctx: TenantRequestContext): Promise<boolean> {
    const s = await this.settings.get(ctx);
    if (s.activeProvider === 'ZARINPAL') return !!s.zarinpal.merchantId;
    if (s.activeProvider === 'BITPAY') return !!s.bitpay.apiKey;
    return false;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult | null> {
    if (await isConversionActive(input.ctx.tenantId, input.ctx.tenantDb)) throw new HttpException(CONVERTING_MSG, 423);
    const s = await this.settings.get(input.ctx);
    if (!s.activeProvider) return null;
    // درگاه‌ها همیشه تومان می‌گیرند؛ اگر ارز پایه ریال است همین‌جا ÷۱۰ (فقط اگر دقیق باشد)
    const amountToman = toGatewayToman(input.amount, await loadBaseCurrency(input.ctx.tenantDb, { fresh: true }));

    if (s.activeProvider === 'ZARINPAL') {
      const result = await this.zarinpal.create({
        merchantId: s.zarinpal.merchantId,
        sandbox: s.zarinpal.sandbox,
        amountToman,
        description: input.description,
        callbackUrl: input.callbackUrl,
        mobile: input.mobile,
        email: input.email,
      });
      if (!result) return null;
      return { redirectUrl: result.redirectUrl, authority: result.authority, provider: 'ZARINPAL' };
    }

    if (s.activeProvider === 'BITPAY') {
      const result = await this.bitpay.create({
        apiKey: s.bitpay.apiKey,
        amountToman,
        description: input.description,
        callbackUrl: input.callbackUrl,
        mobile: input.mobile,
        email: input.email,
      });
      if (!result) return null;
      return { redirectUrl: result.redirectUrl, authority: result.authority, provider: 'BITPAY' };
    }

    return null;
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult | null> {
    if (await isConversionActive(input.ctx.tenantId, input.ctx.tenantDb)) throw new HttpException(CONVERTING_MSG, 423);
    const s = await this.settings.get(input.ctx);
    if (!s.activeProvider) return null;
    const amountToman = toGatewayToman(input.amount, await loadBaseCurrency(input.ctx.tenantDb, { fresh: true }));

    if (s.activeProvider === 'ZARINPAL') {
      const result = await this.zarinpal.verify({
        merchantId: s.zarinpal.merchantId,
        sandbox: s.zarinpal.sandbox,
        amountToman,
        authority: input.authority,
      });
      return { ...result, provider: 'ZARINPAL' };
    }

    if (s.activeProvider === 'BITPAY') {
      const result = await this.bitpay.verify({
        apiKey: s.bitpay.apiKey,
        authority: input.authority,
        transId: input.transId,
      });
      return { ...result, provider: 'BITPAY' };
    }

    return null;
  }
}
