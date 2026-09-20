import { Injectable, Logger } from '@nestjs/common';

// Sandbox vs live only differ by host — same request/response shape.
const SANDBOX_BASE = 'https://sandbox.zarinpal.com/pg/v4/payment';
const LIVE_BASE = 'https://api.zarinpal.com/pg/v4/payment';
const SANDBOX_STARTPAY = 'https://sandbox.zarinpal.com/pg/StartPay/';
const LIVE_STARTPAY = 'https://www.zarinpal.com/pg/StartPay/';

/**
 * Thin wrapper around Zarinpal's REST API v4. Opt-in via ZARINPAL_MERCHANT_ID
 * (same "no-op unless configured" pattern as BAHA24_API_KEY/VAPID keys) —
 * ZARINPAL_SANDBOX defaults to true so a deployment doesn't accidentally take
 * real payments before someone deliberately flips it for production.
 *
 * Amounts everywhere else in this codebase are Toman; Zarinpal's API wants
 * Rial, so every amount crossing this boundary is multiplied/divided by 10 —
 * do that ONLY here, never in callers.
 */
@Injectable()
export class ZarinpalService {
  private readonly logger = new Logger('ZarinpalService');

  get isConfigured(): boolean {
    return !!process.env.ZARINPAL_MERCHANT_ID;
  }

  private get sandbox(): boolean {
    return (process.env.ZARINPAL_SANDBOX ?? 'true') !== 'false';
  }

  private get baseUrl(): string {
    return this.sandbox ? SANDBOX_BASE : LIVE_BASE;
  }

  private get startPayBase(): string {
    return this.sandbox ? SANDBOX_STARTPAY : LIVE_STARTPAY;
  }

  /**
   * Starts a payment: amountToman is converted to Rial for Zarinpal. Returns
   * null if ZARINPAL_MERCHANT_ID isn't set (caller should treat that as "the
   * gateway isn't available", not throw a raw error at the customer) or on
   * an actual gateway error.
   */
  async requestPayment(input: {
    amountToman: number;
    description: string;
    callbackUrl: string;
    mobile?: string;
    /** مرچنت اختصاصی (مثلاً درگاه ماژول پیامک)؛ خالی یعنی مرچنت اصلی پلتفرم */
    merchantId?: string;
  }): Promise<{ authority: string; paymentUrl: string } | null> {
    const merchantId = input.merchantId || process.env.ZARINPAL_MERCHANT_ID;
    if (!merchantId) return null;

    try {
      const res = await fetch(`${this.baseUrl}/request.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: input.amountToman * 10,
          description: input.description,
          callback_url: input.callbackUrl,
          metadata: input.mobile ? { mobile: input.mobile } : undefined,
        }),
      });
      const body = await res.json();
      const authority: string | undefined = body?.data?.authority;
      const code: number | undefined = body?.data?.code;
      if (!authority || code !== 100) {
        this.logger.error(`Zarinpal payment request failed: ${JSON.stringify(body)}`);
        return null;
      }
      return { authority, paymentUrl: `${this.startPayBase}${authority}` };
    } catch (err) {
      this.logger.error(`Zarinpal payment request threw: ${err}`);
      return null;
    }
  }

  async verifyPayment(input: { amountToman: number; authority: string; merchantId?: string }): Promise<{ success: boolean; refId?: number }> {
    const merchantId = input.merchantId || process.env.ZARINPAL_MERCHANT_ID;
    if (!merchantId) return { success: false };

    try {
      const res = await fetch(`${this.baseUrl}/verify.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: input.amountToman * 10,
          authority: input.authority,
        }),
      });
      const body = await res.json();
      const code: number | undefined = body?.data?.code;
      // 100 = freshly verified now; 101 = already verified earlier (e.g. the
      // customer's browser reloaded the callback URL) — both mean "paid".
      if (code === 100 || code === 101) {
        return { success: true, refId: body.data.ref_id };
      }
      this.logger.warn(`Zarinpal verify not successful: ${JSON.stringify(body)}`);
      return { success: false };
    } catch (err) {
      this.logger.error(`Zarinpal verify threw: ${err}`);
      return { success: false };
    }
  }
}
