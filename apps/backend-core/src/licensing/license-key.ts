import { randomInt } from 'node:crypto';
import { LICENSE_KEY_ALPHABET } from './license-crypto.js';

/** LIC-XXXXX-XXXXX-XXXXX-XXXXX با الفبای بدون حروف مبهم (0 O 1 I) و رندوم CSPRNG (randomInt بدون modulo-bias). */
export function generateLicenseKey(): string {
  const group = () => Array.from({ length: 5 }, () => LICENSE_KEY_ALPHABET[randomInt(LICENSE_KEY_ALPHABET.length)]).join('');
  return `LIC-${group()}-${group()}-${group()}-${group()}`;
}

/** تلاش مجدد در برخورد کلید (exists باید در DB بررسی کند). */
export async function generateUniqueLicenseKey(exists: (key: string) => Promise<boolean>, maxTries = 8): Promise<string> {
  for (let i = 0; i < maxTries; i++) {
    const k = generateLicenseKey();
    if (!(await exists(k))) return k;
  }
  throw new Error('تولید کلید یکتای لایسنس ناموفق بود');
}

export const LICENSE_KEY_RE = /^LIC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}){3}$/;

/** کلید دقیق و سالم (برای اعتبارسنجی داخلی). */
export function isWellFormedKey(key: string): boolean {
  return LICENSE_KEY_RE.test(key);
}

/**
 * ورودیِ کلید را trim/upper می‌کند. null = نامعتبر (خالی، بلندتر از ۶۴ یا نویسه‌ی غیرمجاز).
 * عمداً فقط «شکل کلی» بررسی می‌شود؛ کلیدِ خوش‌قالب‌ولی‌ناموجود → license_not_found (مثل مرجع)، و پاسخ هیچ اطلاعاتی درباره‌ی پیشوند نمی‌دهد.
 */
export function normalizeLicenseKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toUpperCase();
  if (!k || k.length > 64) return null;
  return /^[A-Z0-9-]+$/.test(k) ? k : null;
}

/**
 * نرمال‌سازی شناسه: trim + lowercase؛ URL → فقط host(:port)؛ حذف www.؛ حداکثر ۲۵۵.
 * شناسه‌ی نامعتبر/خالی → ''.
 */
export function normalizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let v = raw.trim().toLowerCase();
  if (/^https?:\/\//.test(v)) {
    try {
      v = new URL(v).host;
    } catch {
      v = v.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
    }
  }
  v = v.replace(/^www\./, '');
  // کاراکترهای کنترلی/فضای سفید داخلی مجاز نیستند
  // oxlint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f]/.test(v)) return '';
  return v.slice(0, 255);
}

export type StoredStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type EffectiveStatus = 'active' | 'expired' | 'suspended' | 'revoked';

/** active + expiresAt گذشته → expired (ذخیره نمی‌شود). expiresAt null = دائمی. */
export function effectiveStatus(
  l: { status: StoredStatus; expiresAt: Date | null },
  now: Date = new Date(),
): EffectiveStatus {
  if (l.status === 'SUSPENDED') return 'suspended';
  if (l.status === 'REVOKED') return 'revoked';
  if (l.expiresAt && l.expiresAt.getTime() < now.getTime()) return 'expired';
  return 'active';
}

/** ۸ نویسه‌ی آخر کلید برای لاگ — خود کلید در لاگ نمی‌آید. */
export function keyHint(key: string | null | undefined): string | null {
  return key ? key.slice(-8) : null;
}
