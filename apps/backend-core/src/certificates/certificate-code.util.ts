import { randomInt } from 'node:crypto';
import type { TenantRequestContext } from '../common/request-context.js';

// همان الفبای ماژول گارانتی (warranty-code.util.ts) — عدد+حروف بزرگ انگلیسی،
// بدون کاراکترهای مشابه‌ساز (0,1,I,O,L)، ۱۰ کاراکتر، بدون هیچ الگوی قابل‌حدس.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 10;

export async function generateCertificateCode(ctx: TenantRequestContext): Promise<string> {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[randomInt(ALPHABET.length)];
    }
    const exists = await ctx.tenantDb.certificate.findUnique({ where: { code } });
    if (!exists) return code;
  }
}
