/**
 * کنترل همزمانی خوش‌بینانه برای ویرایش‌های آفلاین: کلاینت هدر X-Base-Updated-At (updatedAt رکوردی که
 * ویرایشش را روی آن انجام داده) می‌فرستد؛ اگر رکورد سرور از آن جدیدتر باشد → ۴۰۹ با کد STALE.
 * عمداً «محتوای» رکورد را برنمی‌گرداند (چون این بررسی پیش از مجوزهای داخل سرویس اجرا می‌شود)؛ کلاینت نسخه‌ی
 * سرور را با GET عادی (که مجوز می‌گیرد) برای حل تعارض می‌خواند. مسیرهای خارج از جدول: آخرین نوشتن برنده + یادداشت ممیزی.
 */
export type StaleModel = 'crmContact' | 'task' | 'dailyChecklistItem';

export type StaleRule = { method: 'PUT' | 'PATCH'; pattern: RegExp; model: StaleModel };

export const STALE_RULES: StaleRule[] = [
  { method: 'PUT', pattern: /^\/crm\/contacts\/([0-9a-zA-Z_-]{1,64})$/, model: 'crmContact' },
  { method: 'PATCH', pattern: /^\/tasks\/([0-9a-zA-Z_-]{1,64})$/, model: 'task' },
  { method: 'PATCH', pattern: /^\/daily-checklist\/([0-9a-zA-Z_-]{1,64})$/, model: 'dailyChecklistItem' },
];

export function matchStaleRule(method: string, path: string): { model: StaleModel; id: string } | null {
  const clean = path.replace(/^\/api(?=\/)/, '').split('?')[0].replace(/\/+$/, '');
  for (const r of STALE_RULES) {
    if (r.method !== method.toUpperCase()) continue;
    const m = r.pattern.exec(clean);
    if (m) return { model: r.model, id: m[1] };
  }
  return null;
}

export function parseBaseUpdatedAt(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** رکورد سرور از نسخه‌ی پایه جدیدتر است؟ (دقت میلی‌ثانیه؛ برابر = تازه) */
export function isStale(currentUpdatedAt: Date, base: Date): boolean {
  return currentUpdatedAt.getTime() > base.getTime();
}
