import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * هر ماژول کاتالوگ یا در ماتریس دسترسی (مشاهده/ایجاد/ویرایش/حذف) است، یا در فهرست «عمداً خارج از ماتریس» با دلیل.
 * ماژول جدیدِ بدون هیچ‌کدام این تست را می‌شکند — یعنی مدیر راهی برای تنظیم دسترسی آن ندارد.
 */
const SEED = resolve(__dirname, '../../prisma/control/seed.ts');
const WEB_API = resolve(__dirname, '../../../web-panel/src/lib/api.ts');

const OUTSIDE_MATRIX: Record<string, string> = {
  'supplier-risk': 'افزونه‌ی CRM؛ با دسترسی ماژول crm کنترل می‌شود',
  'delivery-signature': 'افزونه‌ی فروش؛ با دسترسی ماژول sales کنترل می‌شود',
  'api-access': 'تنظیمات یکپارچه‌سازی؛ فقط مدیر (RolesGuard)',
  webhooks: 'تنظیمات یکپارچه‌سازی؛ فقط مدیر (RolesGuard)',
  mcp: 'کلید API با دامنه‌ی خودش (read/propose/write) + فقط مدیر',
  'currency-exchange': 'تنظیمات ارز؛ فقط مدیر (RolesGuard)',
  voip: 'تنظیمات مدیر + داخلی شخصی هر کاربر',
  'confidential-archive': 'گاوصندوق شخصی با OTP و فهرست دسترسی خودش',
  'payment-gateway': 'تنظیمات درگاه؛ فقط مدیر (RolesGuard)',
  'livestock-feed': 'بسته‌ی صنعتی؛ مجموعه‌ای از ماژول‌های ماتریسی (production، quality-control، ...)',
};

describe('module catalog ↔ permission matrix coverage', () => {
  const seed = readFileSync(SEED, 'utf8');
  const codes = [...seed.matchAll(/\n\s*code:\s*'([a-z0-9-]+)',\s*\n\s*name:/g)].map((m) => m[1]);
  const web = readFileSync(WEB_API, 'utf8');
  const list = (name: string) => new Set([...(new RegExp(`${name} = \\[([\\s\\S]*?)\\] as const`).exec(web)?.[1] ?? '').matchAll(/"([a-z-]+)"/g)].map((x) => x[1]));
  const gated = list('PERMISSION_GATED_MODULE_CODES');
  const exempt = list('PERMISSION_MATRIX_EXEMPT_MODULE_CODES');

  it('parses the catalog (sanity)', () => {
    expect(codes.length).toBeGreaterThan(30);
  });

  it('every catalog module is matrix-gated, exempt, or listed as outside the matrix with a reason', () => {
    const missing = codes.filter((c) => !gated.has(c) && !exempt.has(c) && !(c in OUTSIDE_MATRIX));
    expect(missing).toEqual([]);
  });

  it('the outside-matrix list has no stale entries', () => {
    const stale = Object.keys(OUTSIDE_MATRIX).filter((c) => !codes.includes(c) || gated.has(c));
    expect(stale).toEqual([]);
  });
});
