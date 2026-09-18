import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VoipProviderRegistryService } from '../voip-provider-registry.service.js';
import type { CallEndedEvent, IncomingCallEvent } from '../types.js';

/**
 * نواتل (navatel.ir) — یک سانترال ابری ایرانی که طبق محتوای عمومی سایتشان
 * یک «وب‌سرویس RESTful» ارائه می‌دهد، اما مستندات فنی دقیق وب‌هوک (نام
 * فیلدها، مسیر endpoint، روش احراز هویت) در هیچ صفحه‌ی عمومی‌شان منتشر
 * نشده — فقط از طریق پنل کاربری/پشتیبانی نواتل قابل دریافت است. بنابراین
 * parseWebhook زیر یک استخراج تدافعی چندحالته است (دقیقاً همان الگوی
 * ExchangeRatesService.extractRate برای baha24 که مستندات فیلدهایش هم
 * منتشر نشده بود) — نه یک پیاده‌سازی تأییدشده. وقتی یک نمونه‌ی واقعی از
 * payload وب‌هوک نواتل در دسترس باشد (از پشتیبانی نواتل)، این فایل باید
 * بازبینی شود.
 */
@Injectable()
export class NovatelVoipProvider implements OnModuleInit {
  private readonly logger = new Logger('NovatelVoipProvider');

  constructor(private readonly registry: VoipProviderRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'novatel',
      name: 'نواتل (Navatel)',
      configFields: [{ key: 'sipDomain', label: 'دامنه‌ی ثبت‌نام تلفن IP / سافت‌فون (SIP Domain)' }],
      parseWebhook: (rawBody: unknown): IncomingCallEvent | null => {
        if (!rawBody || typeof rawBody !== 'object') return null;
        const body = rawBody as Record<string, unknown>;

        const pick = (keys: string[]): string | null => {
          for (const key of keys) {
            const value = body[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
            if (typeof value === 'number') return String(value);
          }
          return null;
        };

        const fromNumber = pick(['caller', 'from', 'src', 'callerNumber', 'caller_id']);
        const toExtension = pick(['callee', 'extension', 'dst', 'destination', 'internal']);
        const callId = pick(['callId', 'uniqueid', 'call_id', 'id']) ?? '';

        if (!fromNumber || !toExtension) {
          this.logger.warn(`Could not parse a Navatel webhook payload — field names unconfirmed: ${JSON.stringify(body)}`);
          return null;
        }
        return { fromNumber, toExtension, callId };
      },
      // همان استخراج تدافعی چندحالته‌ی بالا، این‌بار برای رویداد پایان
      // تماس — نام فیلدها (و اینکه نواتل چنین وب‌هوکی اصلاً ارسال می‌کند
      // یا نه) تأییدشده نیست. اگر duration/recordingUrl را پیدا نکند،
      // فقط همان فیلدهای موجود را برمی‌گرداند؛ چیزی حدس زده نمی‌شود.
      parseCallEndedWebhook: (rawBody: unknown): CallEndedEvent | null => {
        if (!rawBody || typeof rawBody !== 'object') return null;
        const body = rawBody as Record<string, unknown>;

        const pick = (keys: string[]): string | null => {
          for (const key of keys) {
            const value = body[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
            if (typeof value === 'number') return String(value);
          }
          return null;
        };

        const callId = pick(['callId', 'uniqueid', 'call_id', 'id']);
        if (!callId) return null;
        const durationRaw = pick(['duration', 'billsec', 'call_duration']);
        const durationSeconds = durationRaw ? Number(durationRaw) : undefined;
        const recordingUrl = pick(['recordingUrl', 'recording_url', 'recording']) ?? undefined;
        const statusRaw = pick(['status', 'disposition']);
        const status =
          statusRaw === 'ANSWERED' || statusRaw === 'ANSWER'
            ? 'ANSWERED'
            : statusRaw === 'NO ANSWER' || statusRaw === 'NO_ANSWER'
              ? 'NO_ANSWER'
              : statusRaw === 'BUSY' || statusRaw === 'FAILED'
                ? 'FAILED'
                : undefined;
        return { callId, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined, recordingUrl, status };
      },
      // originateCall عمداً پیاده‌سازی نشده: نواتل هیچ مستند فنی عمومی
      // برای تریگر تماس خروجی (endpoint، احراز هویت) منتشر نکرده — پیاده‌سازی
      // بدون آن یعنی حدس‌زدن یک API که ممکن است حتی وجود نداشته باشد.
      // اگر پشتیبانی نواتل این مستند را در اختیار بگذارد، اینجا تکمیل شود.
    });
  }
}
