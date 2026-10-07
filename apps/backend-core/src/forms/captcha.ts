import { BadRequestException } from '@nestjs/common';

/**
 * قلاب کپچای نامرئی (سازگار با Cloudflare Turnstile / hCaptcha / reCAPTCHA siteverify).
 * فقط وقتی فعال می‌شود که FORMS_CAPTCHA_SECRET و FORMS_CAPTCHA_VERIFY_URL هر دو تنظیم باشند؛
 * در غیر این صورت بی‌اثر است. توکن در فیلد `captchaToken` بدنه‌ی ارسال می‌آید.
 */
export async function verifyCaptcha(token: string | null, ip: string | null, fetchImpl: typeof fetch = fetch): Promise<void> {
  const secret = process.env.FORMS_CAPTCHA_SECRET;
  const url = process.env.FORMS_CAPTCHA_VERIFY_URL;
  if (!secret || !url) return;
  if (!token) throw new BadRequestException('تأیید امنیتی (کپچا) انجام نشده است');
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }).toString(),
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json()) as { success?: boolean };
    if (data.success === true) return;
  } catch {
    /* خطای شبکه → رد */
  }
  throw new BadRequestException('تأیید امنیتی (کپچا) ناموفق بود');
}
