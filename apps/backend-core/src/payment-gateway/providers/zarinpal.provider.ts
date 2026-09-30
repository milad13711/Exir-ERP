import { Injectable, Logger } from '@nestjs/common';
import type { FetchLike, GatewayCreateResult, GatewayVerifyResult } from './gateway-provider.types.js';

// همان دو ثابت apps/backend-core/src/billing/zarinpal.service.ts (منبع مرجع این پیاده‌سازی) —
// sandbox/live فقط در host فرق دارند، شکل request/response یکی است.
const SANDBOX_BASE = 'https://sandbox.zarinpal.com/pg/v4/payment';
const LIVE_BASE = 'https://api.zarinpal.com/pg/v4/payment';
const SANDBOX_STARTPAY = 'https://sandbox.zarinpal.com/pg/StartPay/';
const LIVE_STARTPAY = 'https://www.zarinpal.com/pg/StartPay/';

/**
 * پیاده‌سازی زرین‌پال برای ماژول عمومی «درگاه پرداخت» — با مرچنت اختصاصی هر
 * تننت (بر خلاف apps/backend-core/src/billing/zarinpal.service.ts که مرچنت
 * خودِ اکسیر را برای خرید ماژول از کاتالوگ استفاده می‌کند). شکل
 * request.json/verify.json عیناً از همان سرویس مرجع کپی شده تا رفتار در
 * تولید (sandbox-vs-live، فیلدهای merchant_id/amount) با نمونه‌ی کار کرده‌ی
 * موجود در این پروژه یکسان بماند.
 *
 * مبلغ ورودی تومان است؛ API زرین‌پال ریال می‌خواهد — تبدیل فقط همین‌جا انجام می‌شود.
 */
@Injectable()
export class ZarinpalGatewayProvider {
  private readonly logger = new Logger('ZarinpalGatewayProvider');

  async create(
    input: { merchantId: string; sandbox: boolean; amountToman: number; description: string; callbackUrl: string; mobile?: string; email?: string },
    fetchImpl: FetchLike = fetch,
  ): Promise<GatewayCreateResult> {
    if (!input.merchantId) return null;
    const baseUrl = input.sandbox ? SANDBOX_BASE : LIVE_BASE;
    const startPayBase = input.sandbox ? SANDBOX_STARTPAY : LIVE_STARTPAY;
    try {
      const res = await fetchImpl(`${baseUrl}/request.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: input.merchantId,
          amount: input.amountToman * 10,
          description: input.description,
          callback_url: input.callbackUrl,
          metadata: input.mobile || input.email ? { mobile: input.mobile, email: input.email } : undefined,
        }),
      });
      const body: any = await res.json();
      const authority: string | undefined = body?.data?.authority;
      const code: number | undefined = body?.data?.code;
      if (!authority || code !== 100) {
        this.logger.error(`Zarinpal payment request failed: ${JSON.stringify(body)}`);
        return null;
      }
      return { authority, redirectUrl: `${startPayBase}${authority}` };
    } catch (err) {
      this.logger.error(`Zarinpal payment request threw: ${err}`);
      return null;
    }
  }

  async verify(
    input: { merchantId: string; sandbox: boolean; amountToman: number; authority: string },
    fetchImpl: FetchLike = fetch,
  ): Promise<GatewayVerifyResult> {
    if (!input.merchantId) return { success: false };
    const baseUrl = input.sandbox ? SANDBOX_BASE : LIVE_BASE;
    try {
      const res = await fetchImpl(`${baseUrl}/verify.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: input.merchantId,
          amount: input.amountToman * 10,
          authority: input.authority,
        }),
      });
      const body: any = await res.json();
      const code: number | undefined = body?.data?.code;
      // ۱۰۰ یعنی همین الان تأیید شد؛ ۱۰۱ یعنی قبلاً تأیید شده بود (مثلاً کاربر صفحه‌ی برگشت را رفرش کرده) — هر دو یعنی «پرداخت شده».
      if (code === 100 || code === 101) {
        return { success: true, refId: String(body.data.ref_id) };
      }
      this.logger.warn(`Zarinpal verify not successful: ${JSON.stringify(body)}`);
      return { success: false };
    } catch (err) {
      this.logger.error(`Zarinpal verify threw: ${err}`);
      return { success: false };
    }
  }
}
