import { randomInt } from 'node:crypto';
import type { TenantRequestContext } from '../common/request-context.js';

// حروف کوچک+عدد، بدون کاراکترهای مشابه‌ساز (0,1,l,o) — چون این کد داخل خودِ
// آدرس لینک واسط قرار می‌گیرد (نه چیزی که دستی تایپ شود)، طول کوتاه (۸
// کاراکتر) هم برای یکتایی در سطح یک تننت کافی است.
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
const CODE_LENGTH = 8;

export async function generateQrCode(ctx: TenantRequestContext): Promise<string> {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[randomInt(ALPHABET.length)];
    }
    const exists = await ctx.tenantDb.qrCode.findUnique({ where: { code } });
    if (!exists) return code;
  }
}

/** فقط http/https مطلق قبول می‌شود — برای پرهیز از مقصدهایی مثل javascript: که در ریدایرکت خطرناک‌اند. */
export function isSafeRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
