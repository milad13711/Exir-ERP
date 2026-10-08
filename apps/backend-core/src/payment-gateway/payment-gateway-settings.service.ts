import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { AppSecretsKeyMissingError, gatewayAad, isAppSecretsKeyConfigured, openSecret, sealSecret } from '../security/app-secrets.js';

const MODULE_CODE = 'payment-gateway';
const SETTINGS_KEY = 'settings';

export type GatewayProvider = 'ZARINPAL' | 'BITPAY';

export type PaymentGatewaySettings = {
  /** null یعنی هنوز هیچ درگاهی برای این تننت فعال نشده — createPayment باید null برگرداند. */
  activeProvider: GatewayProvider | null;
  zarinpal: {
    merchantId: string;
    sandbox: boolean;
  };
  bitpay: {
    apiKey: string;
    /** بیت‌پی تست/سندباکس رسمی ندارد؛ فقط برای هم‌شکلی با زرین‌پال نگه داشته شده و فعلاً اثر رفتاری ندارد. */
    testMode: boolean;
  };
};

/** آنچه با GET برمی‌گردد — رمزها/کلیدها ماسک می‌شوند تا در پنل لو نروند. */
export type PaymentGatewaySettingsView = {
  activeProvider: GatewayProvider | null;
  zarinpal: { merchantId: string; hasMerchantId: boolean; sandbox: boolean };
  bitpay: { apiKey: string; hasApiKey: boolean; testMode: boolean };
};

export type UpdatePaymentGatewaySettingsDto = Partial<{
  activeProvider: GatewayProvider | null;
  zarinpalMerchantId: string;
  zarinpalSandbox: boolean;
  bitpayApiKey: string;
  bitpayTestMode: boolean;
}>;

function defaultSettings(): PaymentGatewaySettings {
  return {
    activeProvider: null,
    zarinpal: { merchantId: '', sandbox: true },
    bitpay: { apiKey: '', testMode: true },
  };
}

/** برای نمایش در پنل: آخرین ۴ کاراکتر باقی می‌ماند، بقیه با • جایگزین می‌شود. */
function mask(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 4) return '•'.repeat(secret.length);
  return '•'.repeat(secret.length - 4) + secret.slice(-4);
}

@Injectable()
export class PaymentGatewaySettingsService {
  /** برای مصرف داخلی سرویس‌های دیگر (PaymentGatewayService) — مقادیر واقعی، بدون ماسک. */
  async get(ctx: TenantRequestContext): Promise<PaymentGatewaySettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: SETTINGS_KEY } },
    });
    if (!row) return defaultSettings();
    const stored = row.value as Partial<PaymentGatewaySettings>;
    const defaults = defaultSettings();
    const merged: PaymentGatewaySettings = {
      activeProvider: stored.activeProvider ?? null,
      zarinpal: { ...defaults.zarinpal, ...(stored.zarinpal ?? {}) },
      bitpay: { ...defaults.bitpay, ...(stored.bitpay ?? {}) },
    };
    // رازها در DB رمزشده‌اند (AES-256-GCM)؛ ردیف قدیمیِ متن‌ساده همچنان خوانده و در همین خواندن رمزشده بازنویسی می‌شود.
    const m = openSecret(merged.zarinpal.merchantId, gatewayAad(ctx.tenantId, 'zarinpal.merchantId'));
    const b = openSecret(merged.bitpay.apiKey, gatewayAad(ctx.tenantId, 'bitpay.apiKey'));
    merged.zarinpal.merchantId = m.value;
    merged.bitpay.apiKey = b.value;
    if ((m.legacy && m.value) || (b.legacy && b.value)) {
      if (isAppSecretsKeyConfigured()) await this.persist(ctx, merged).catch(() => {});
    }
    return merged;
  }

  private async persist(ctx: TenantRequestContext, plain: PaymentGatewaySettings): Promise<void> {
    const value = {
      ...plain,
      zarinpal: { ...plain.zarinpal, merchantId: sealSecret(plain.zarinpal.merchantId, gatewayAad(ctx.tenantId, 'zarinpal.merchantId')) },
      bitpay: { ...plain.bitpay, apiKey: sealSecret(plain.bitpay.apiKey, gatewayAad(ctx.tenantId, 'bitpay.apiKey')) },
    };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: SETTINGS_KEY } },
      create: { moduleCode: MODULE_CODE, key: SETTINGS_KEY, value },
      update: { value },
    });
  }

  /** برای نمایش در UI — کلیدها/مرچنت‌ها ماسک‌شده. */
  async getView(ctx: TenantRequestContext): Promise<PaymentGatewaySettingsView> {
    const s = await this.get(ctx);
    return {
      activeProvider: s.activeProvider,
      zarinpal: { merchantId: mask(s.zarinpal.merchantId), hasMerchantId: !!s.zarinpal.merchantId, sandbox: s.zarinpal.sandbox },
      bitpay: { apiKey: mask(s.bitpay.apiKey), hasApiKey: !!s.bitpay.apiKey, testMode: s.bitpay.testMode },
    };
  }

  /** فقط مالک/مدیر می‌توانند تنظیمات درگاه پرداخت را تغییر دهند — همان قاعده‌ی این پروژه برای تنظیمات سطح تننت. */
  async update(ctx: TenantRequestContext, dto: UpdatePaymentGatewaySettingsDto): Promise<PaymentGatewaySettingsView> {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر محیط کاری می‌تواند تنظیمات درگاه پرداخت را تغییر دهد');
    }
    const current = await this.get(ctx);
    const next: PaymentGatewaySettings = {
      activeProvider: dto.activeProvider !== undefined ? dto.activeProvider : current.activeProvider,
      zarinpal: {
        // رشته‌ی خالی یعنی «تغییر نده» — چون مقدار ماسک‌شده هیچ‌وقت از فرانت به‌عنوان مقدار واقعی فرستاده نمی‌شود؛
        // فقط وقتی کاربر واقعاً یک مقدار جدید تایپ کرده این فیلد پر می‌آید.
        merchantId: dto.zarinpalMerchantId !== undefined && dto.zarinpalMerchantId.trim() ? dto.zarinpalMerchantId.trim() : current.zarinpal.merchantId,
        sandbox: dto.zarinpalSandbox !== undefined ? dto.zarinpalSandbox : current.zarinpal.sandbox,
      },
      bitpay: {
        apiKey: dto.bitpayApiKey !== undefined && dto.bitpayApiKey.trim() ? dto.bitpayApiKey.trim() : current.bitpay.apiKey,
        testMode: dto.bitpayTestMode !== undefined ? dto.bitpayTestMode : current.bitpay.testMode,
      },
    };
    if (next.activeProvider === 'ZARINPAL' && !next.zarinpal.merchantId) {
      throw new ForbiddenException('برای فعال‌سازی زرین‌پال ابتدا مرچنت‌کد را وارد کنید');
    }
    if (next.activeProvider === 'BITPAY' && !next.bitpay.apiKey) {
      throw new ForbiddenException('برای فعال‌سازی بیت‌پی ابتدا کلید API را وارد کنید');
    }
    try {
      await this.persist(ctx, next);
    } catch (err) {
      if (err instanceof AppSecretsKeyMissingError) {
        throw new ServiceUnavailableException('رمزنگاری رازها روی سرور پیکربندی نشده است (APP_SECRETS_KEY)؛ با پشتیبانی تماس بگیرید');
      }
      throw err;
    }
    // بدون APP_SECRETS_KEY خطا می‌دهد (fail-closed) — متن ساده هرگز ذخیره نمی‌شود
    return this.getView(ctx);
  }
}
