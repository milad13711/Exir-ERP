import { createHash, timingSafeEqual } from 'node:crypto';

/** مقایسه‌ی ثابت‌زمان دو رشته (هر طولی) — با هش‌کردن، طول مقدار مخفی هم لو نمی‌رود. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
