import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VoipProviderRegistryService } from '../voip-provider-registry.service.js';
import type { IncomingCallEvent } from '../types.js';

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
      name: 'نواتل (Navatel) — نیازمند تکمیل با نمونه‌ی واقعی وب‌هوک از پشتیبانی نواتل',
      configFields: [
        {
          key: 'sipDomain',
          label: 'دامنه‌ی ثبت‌نام تلفن IP / سافت‌فون (SIP Domain) — مثل voice.navaphone.com',
        },
        { key: 'apiBaseUrl', label: 'آدرس پایه‌ی API (از پنل نواتل، اختیاری — فقط برای وب‌هوک/تماس مستقیم)' },
        { key: 'apiKey', label: 'کلید API (اختیاری — فقط برای وب‌هوک/تماس مستقیم)' },
      ],
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
    });
  }
}
