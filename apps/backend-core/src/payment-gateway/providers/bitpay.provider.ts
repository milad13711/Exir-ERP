import { Injectable, Logger } from '@nestjs/common';
import type { FetchLike, GatewayCreateResult, GatewayVerifyResult } from './gateway-provider.types.js';

/**
 * پیاده‌سازی بیت‌پی (bitpay.ir — درگاه ایرانی، نه شرکت رمزارز آمریکایی
 * هم‌نام). این پیاده‌سازی از روی PDF راهنمای رسمی (gateway-help-v2.2.pdf)
 * قابل‌واکشی نبود (بدون دسترسی اینترنت در این محیط)، پس بر پایه‌ی دانش عمومی
 * از REST API مستندِ bitpay.ir نوشته شده — endpoint ها و شکل پاسخ (پاسخ متنیِ
 * جداشده با کاما، کد ۱ یعنی موفق) با مستندات عمومی این درگاه مطابقت دارد اما
 * قبل از اتصال به مرچنت واقعی حتماً باید دوباره در برابر PDF رسمی یا یک
 * تراکنش تستِ واقعی راستی‌آزمایی شود — این بخش، بر خلاف زرین‌پال، در این
 * پروژه پیاده‌سازی/تست‌شده‌ی قبلی نداشت.
 *
 * جریان کلی:
 *  ۱. create → POST گateway-send با api+amount(ریال)+redirect → پاسخ متنی
 *     "1,{id_get}" یعنی موفق؛ هر چیز دیگری (یا کد منفی) یعنی خطا.
 *  ۲. کاربر به gateway-{id_get} ریدایرکت می‌شود.
 *  ۳. بیت‌پی با POST به callbackUrl برمی‌گردد (id_get و trans_id در بدنه).
 *  ۴. verify → POST gateway-result-second با api+id_get+trans_id → پاسخ
 *     متنی "1,amount,cardNumber,..." یعنی موفق.
 *
 * چون قرارداد عمومی PaymentGatewayService فقط یک `authority` رشته‌ای بین
 * create/verify منتقل می‌کند (هم‌شکل با زرین‌پال)، همان id_get به‌عنوان
 * authority استفاده می‌شود؛ transId واقعی بیت‌پی از طریق callback جداگانه
 * (پارامتر trans_id در بدنه‌ی POST که بیت‌پی می‌فرستد) باید توسط کنترلر
 * callback هر ماژول مصرف‌کننده جداگانه گرفته و به verify پاس داده شود —
 * اینجا برای سادگیِ قرارداد، trans_id را هم از طریق فیلد اختیاری transId می‌پذیریم.
 */
const CREATE_URL = 'https://bitpay.ir/payment/gateway-send';
const REDIRECT_BASE = 'https://bitpay.ir/payment/gateway-';
const VERIFY_URL = 'https://bitpay.ir/payment/gateway-result-second';

@Injectable()
export class BitpayGatewayProvider {
  private readonly logger = new Logger('BitpayGatewayProvider');

  async create(
    input: { apiKey: string; amountToman: number; description: string; callbackUrl: string; mobile?: string; email?: string },
    fetchImpl: FetchLike = fetch,
  ): Promise<GatewayCreateResult> {
    if (!input.apiKey) return null;
    try {
      const body = new URLSearchParams({
        api: input.apiKey,
        // بیت‌پی مبلغ را به ریال می‌خواهد — همان تبدیل تومان→ریال زرین‌پال، فقط این‌جا.
        amount: String(input.amountToman * 10),
        redirect: input.callbackUrl,
        description: input.description,
        ...(input.mobile ? { mobile: input.mobile } : {}),
        ...(input.email ? { email: input.email } : {}),
      });
      const res = await fetchImpl(CREATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const text = (await res.text()).trim();
      const [status, idGet] = text.split(',');
      if (status !== '1' || !idGet) {
        this.logger.error(`Bitpay payment request failed: ${text}`);
        return null;
      }
      return { authority: idGet, redirectUrl: `${REDIRECT_BASE}${idGet}` };
    } catch (err) {
      this.logger.error(`Bitpay payment request threw: ${err}`);
      return null;
    }
  }

  async verify(
    input: { apiKey: string; authority: string; transId?: string },
    fetchImpl: FetchLike = fetch,
  ): Promise<GatewayVerifyResult> {
    if (!input.apiKey || !input.authority) return { success: false };
    try {
      const body = new URLSearchParams({
        api: input.apiKey,
        id_get: input.authority,
        // اگر callback واقعی trans_id جداگانه بدهد از آن استفاده می‌شود، وگرنه
        // خود id_get را هم به‌عنوان fallback می‌فرستیم (بعضی پیاده‌سازی‌های
        // دیده‌شده‌ی این درگاه این دو را برابر می‌پذیرند).
        trans_id: input.transId ?? input.authority,
      });
      const res = await fetchImpl(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const text = (await res.text()).trim();
      const [status, ...rest] = text.split(',');
      if (status !== '1') {
        this.logger.warn(`Bitpay verify not successful: ${text}`);
        return { success: false };
      }
      return { success: true, refId: input.authority + (rest.length ? `:${rest.join(',')}` : '') };
    } catch (err) {
      this.logger.error(`Bitpay verify threw: ${err}`);
      return { success: false };
    }
  }
}
