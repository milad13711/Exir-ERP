import type { TenantRequestContext } from '../common/request-context.js';

// همان الفبای ۳۲ کاراکتری ماژول گارانتی قدیمی (پرفکس) — حروف بزرگ+عدد، بدون
// 0،1،I،O،L چون در چاپ/خواندن دستی روی لیبل به‌سادگی با هم اشتباه می‌شوند.
// کاملاً تصادفی و بدون هیچ الگوی قابل‌رمزگشایی (نه ترتیبی، نه رمزگذاری‌شده از
// روی شناسه فاکتور/کالا) تا حدس‌زدن کد بعدی عملاً غیرممکن باشد. طول و الفبا
// عمداً عیناً همان استاندارد قبلی نگه داشته شده تا کدهای جدید از نظر شکل با
// کدهای قدیمی که بعداً وارد می‌شوند یکسان باشند.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 10;

export async function generateWarrantyCode(ctx: TenantRequestContext): Promise<string> {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const exists = await ctx.tenantDb.warrantyCode.findUnique({ where: { code } });
    if (!exists) return code;
  }
}

export function normalizeWarrantyCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/-/g, '');
}
