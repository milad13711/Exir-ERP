import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VoipProviderRegistryService } from '../voip-provider-registry.service.js';
import type { CallEndedEvent, IncomingCallEvent, OriginateResult } from '../types.js';

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
/** اگر کاربر به‌جای خودِ توکن، کل متن {"api_key":"..."} را چسبانده باشد، فقط مقدار توکن جدا می‌شود. */
export function normalizeNavatelToken(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const embedded = raw.match(/[0-9a-fA-F]{64}/);
  return raw.startsWith('{') || raw.startsWith('"') ? (embedded?.[0] ?? raw) : raw;
}

@Injectable()
export class NovatelVoipProvider implements OnModuleInit {
  private readonly logger = new Logger('NovatelVoipProvider');

  constructor(private readonly registry: VoipProviderRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'novatel',
      name: 'نواتل (Navatel)',
      configFields: [
        { key: 'sipDomain', label: 'دامنه‌ی ثبت‌نام تلفن IP / سافت‌فون (SIP Domain) — مثلاً voice.navaphone.com با پروتکل TCP' },
        { key: 'apiToken', label: 'توکن API نواتل (برای تماس با یک کلیک و دریافت رکورد مکالمات)' },
        { key: 'wssUrl', label: 'آدرس WebSocket برای تماس مستقیم از مرورگر (از پشتیبانی نواتل بگیرید)' },
        { key: 'adminPhone', label: 'شماره‌ی ادمین مرکز تلفنی نواتل (برای تماس با یک کلیک)' },
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

        // ساختار مستند‌شده‌ی وب‌هوک نواتل: callID/source/destination/direction/eventType — فقط «ringing ورودی» تماس ورودی است
        const eventType = pick(['eventType']);
        const direction = pick(['direction']);
        if (eventType && eventType !== 'ringing') return null;
        if (direction && direction !== 'in') return null;

        const fromNumber = pick(['source', 'caller', 'from', 'src', 'callerNumber', 'caller_id']);
        const toExtension = pick(['destination', 'callee', 'extension', 'dst', 'internal']);
        const callId = pick(['callID', 'callId', 'uniqueid', 'call_id', 'id']) ?? '';

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

        const eventType = pick(['eventType']);
        if (eventType && eventType !== 'hangup') return null;
        const callId = pick(['callID', 'callId', 'uniqueid', 'call_id', 'id']);
        if (!callId) return null;
        const durationRaw = pick(['duration', 'billsec', 'call_duration']);
        const durationSeconds = durationRaw ? Number(durationRaw) : undefined;
        const recFile = pick(['rec_file']);
        const recordingUrl =
          pick(['recordingUrl', 'recording_url', 'recording']) ??
          (recFile ? `https://navaphone.com/ipbx/api/v1/download/${recFile}` : undefined);
        const statusRaw = pick(['state', 'status', 'disposition']);
        const status =
          statusRaw === 'answered' || statusRaw === 'ANSWERED' || statusRaw === 'ANSWER'
            ? 'ANSWERED'
            : statusRaw === 'unanswered'
              ? 'MISSED'
            : statusRaw === 'NO ANSWER' || statusRaw === 'NO_ANSWER'
              ? 'NO_ANSWER'
              : statusRaw === 'BUSY' || statusRaw === 'FAILED'
                ? 'FAILED'
                : undefined;
        return { callId, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined, recordingUrl, status };
      },
      // تماس با یک کلیک — طبق مستند رسمی نواتل: POST /ipbx/api/v1/click2dial/dial با هدر Authorization (توکن)
      originateCall: async (config, fromExtension, toNumber): Promise<OriginateResult> => {
        // اگر کاربر به‌جای خودِ توکن، کل متن {"api_key":"..."} را چسبانده باشد، فقط مقدار توکن جدا می‌شود
        const token = normalizeNavatelToken(config.apiToken);
        const adminPhone = typeof config.adminPhone === 'string' ? config.adminPhone.trim() : '';
        if (!token || !adminPhone) {
          return { success: false, error: 'توکن API و شماره‌ی ادمین نواتل در تنظیمات VoIP کامل نشده است' };
        }
        try {
          const res = await fetch('https://navaphone.com/ipbx/api/v1/click2dial/dial', {
            method: 'POST',
            headers: { Authorization: token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: fromExtension, to: toNumber, admin: adminPhone }),
            signal: AbortSignal.timeout(15_000),
          });
          const rawText = await res.text();
          let data: Record<string, unknown> | null = null;
          try {
            data = JSON.parse(rawText) as Record<string, unknown>;
          } catch {
            data = null;
          }
          if (!res.ok || data?.ok === false) {
            const pickText = (v: unknown): string => (typeof v === 'string' ? v : '');
            const reason = pickText(data?.err) || pickText(data?.error) || pickText(data?.message) || pickText(data?.msg) || rawText.slice(0, 200);
            this.logger.warn(`Navatel click2dial failed (HTTP ${res.status}): ${reason}`);
            const hints: Record<string, string> = {
              'internal phone not matched': 'داخلی شما در نواتل پیدا نشد — «نام کاربری SIP» شما در تنظیمات باید دقیقاً همان شماره‌ی داخلی اپراتور در پنل نواتل باشد',
            };
            return { success: false, error: hints[reason] ?? `نواتل خطا داد (HTTP ${res.status})${reason ? `: ${reason}` : ''}` };
          }
          const id = data && (data.callID ?? data.callId ?? data.id);
          return { success: true, callId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined };
        } catch (err) {
          return { success: false, error: `اتصال به نواتل ناموفق بود: ${err instanceof Error ? err.message : 'خطای ناشناخته'}` };
        }
      },
    });
  }
}
