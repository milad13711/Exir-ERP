import { Injectable, Logger } from '@nestjs/common';

// اکسیر پیامک (exirsms.ir) نماینده‌ی لیمو پیامک است — طبق تأیید کارفرما،
// مستندات و ساختار وب‌سرویس exirsms.ir دقیقاً همان لیمو پیامک است. آدرس
// api.exirsms.ir در DNS ثبت نشده (فقط سایت معرفی محصول روی exirsms.ir
// میزبانی می‌شود)، پس مستقیماً به درگاه واقعیِ لیمو وصل می‌شویم —
// EXIR_SMS_API_BASE_URL این را قابل تغییر نگه می‌دارد، برای وقتی که
// api.exirsms.ir منتشر شود یا آدرس دیگری تأیید شود.
const DEFAULT_BASE_URL = 'https://api.limosms.com';

export type SmsCredentials = { apiKey?: string; sender?: string };
export type SendSmsResult = { success: true } | { success: false; error: string };

/**
 * Thin client for the LimoSMS-family SMS API. Request shape confirmed
 * against the LIVE endpoint (not just docs), iterating on its validation
 * error responses until a fake-but-well-formed request got past field
 * binding into "کد دسترسی غیرفعال می‌باشد" (HTTP 401, invalid ApiKey) —
 * i.e. a flat body with MobileNumber as an array (`System.String[]`) even
 * for one recipient; ApiKey header, SenderNumber and Message were correct
 * from the start. Still not verified against a real ApiKey (only the
 * request shape), so a genuine account should be smoke-tested once
 * available. Some panels in this family return HTTP 200 even for a logical
 * failure (e.g. insufficient credit), so the response body is also
 * inspected for a common success flag on top of the HTTP status,
 * defensively — if that flag isn't present, the HTTP status alone decides.
 *
 * Configured via EXIR_SMS_API_KEY + EXIR_SMS_SENDER_LINE. Both empty means
 * "not configured" — callers (AuthService) fall back to OTP_DEV_ECHO in
 * that case rather than failing login outright.
 */
@Injectable()
export class ExirSmsService {
  private readonly logger = new Logger('ExirSmsService');

  isConfigured(): boolean {
    return Boolean(process.env.EXIR_SMS_API_KEY && process.env.EXIR_SMS_SENDER_LINE);
  }

  /** ارسال از پنل سیستمی اکسیر — فقط برای پیامک‌های خودِ پلتفرم (OTP ورود، فاکتور/تمدید ماژول‌ها، اطلاع فعال‌سازی دسترسی). */
  async sendSms(phone: string, message: string): Promise<SendSmsResult> {
    return this.sendWith({ apiKey: process.env.EXIR_SMS_API_KEY, sender: process.env.EXIR_SMS_SENDER_LINE }, phone, message);
  }

  /** ارسال با اعتبارنامه‌ی دلخواه — پنل اختصاصی تننت یا پنل سیستمی. */
  async sendWith(creds: SmsCredentials, phone: string, message: string): Promise<SendSmsResult> {
    const apiKey = creds.apiKey;
    const sender = creds.sender;
    if (!apiKey || !sender) {
      return { success: false, error: 'اکسیر پیامک پیکربندی نشده است (EXIR_SMS_API_KEY / EXIR_SMS_SENDER_LINE)' };
    }

    const baseUrl = (process.env.EXIR_SMS_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const url = `${baseUrl}/api/sendsms`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ApiKey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Message: message, SenderNumber: sender, MobileNumber: [phone] }),
        signal: AbortSignal.timeout(15_000),
      });

      const bodyText = await res.text();
      if (!res.ok) {
        this.logger.error(`SMS gateway sendsms failed (HTTP ${res.status}): ${bodyText}`);
        return { success: false, error: `سرویس پیامک خطا داد (HTTP ${res.status})` };
      }

      const logicalError = extractLogicalError(bodyText);
      if (logicalError) {
        this.logger.error(`SMS gateway reported failure despite HTTP 200: ${bodyText}`);
        return { success: false, error: logicalError };
      }

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطای ناشناخته';
      this.logger.error(`SMS gateway request failed: ${message}`);
      return { success: false, error: `ارسال پیامک ناموفق بود: ${message}` };
    }
  }

  /**
   * مانده‌ی اعتبار پنل (getcurrentcredit). credit به ریال است و smsCount تعداد پیامک تخمینی
   * را می‌دهد؛ اگر پنل smsCount نداد، null برمی‌گردد و فقط اعتبار نمایش داده می‌شود.
   */
  async getCredit(apiKey: string): Promise<{ success: true; smsCount: number | null; creditRial: number | null } | { success: false; error: string }> {
    const baseUrl = (process.env.EXIR_SMS_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    try {
      const res = await fetch(`${baseUrl}/api/getcurrentcredit`, {
        method: 'POST',
        headers: { ApiKey: apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string; result?: { credit?: number; smsCount?: number } } | null;
      if (!res.ok || !body || body.success === false) {
        return { success: false, error: body?.message ?? `سرویس پیامک خطا داد (HTTP ${res.status})` };
      }
      return { success: true, smsCount: body.result?.smsCount ?? null, creditRial: body.result?.credit ?? null };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'خطای ناشناخته' };
    }
  }
}

/** Returns an error message if the (parseable) response body signals a logical failure, else null. */
function extractLogicalError(bodyText: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null; // not JSON — nothing to check, HTTP status already decided success
  }
  if (typeof body !== 'object' || body === null) return null;

  const record = body as Record<string, unknown>;
  const successFlag = record.IsSuccessful ?? record.isSuccessful ?? record.Success ?? record.success;
  if (successFlag === false) {
    const msg = record.Message ?? record.message ?? record.Error ?? record.error;
    return typeof msg === 'string' ? msg : 'سرویس پیامک ارسال را ناموفق اعلام کرد';
  }
  return null;
}
