/**
 * قفل نوشتن «اسناد مالی» هنگام تبدیل ارز پایه. وضعیت در حافظه‌ی همین پروسه نگه داشته می‌شود
 * (عملیات داخل همین پروسه اجرا می‌شود) و برای اطمینان در برابر پروسه‌ی دیگر/ری‌استارت با ردیف RUNNING دیتابیس
 * هم تطبیق داده می‌شود (کش کوتاه). قفل دیتابیسی واقعی (LOCK TABLE) داخل تراکنش تبدیل جداست.
 */
type LockEntry = { conversionId: string; since: number; slug: string };
const locked = new Map<string, LockEntry>(); // tenantId → entry
const slugToTenant = new Map<string, string>();
/** درخواست‌های مالیِ در حال اجرا: کلید = tenantId (کاربر وارد‌شده) یا `slug:<slug>` (عمومی) */
const inflight = new Map<string, number>();

const slugKey = (slug: string) => `slug:${slug}`;

export const writeLock = {
  acquire(tenantId: string, conversionId: string, slug = ''): void {
    locked.set(tenantId, { conversionId, since: Date.now(), slug });
    if (slug) slugToTenant.set(slug, tenantId);
  },
  release(tenantId: string): void {
    const e = locked.get(tenantId);
    if (e?.slug) slugToTenant.delete(e.slug);
    locked.delete(tenantId);
  },
  isLocked(tenantId: string): boolean {
    return locked.has(tenantId);
  },
  /** برای مسیرهای عمومی: فقط همان تننتی که اسلاگش قفل است. اسلاگ ناشناس ⇒ false (مسدود نمی‌کنیم). */
  isSlugLocked(slug: string | undefined): boolean {
    return !!slug && slugToTenant.has(slug);
  },
  anyLocked(): boolean {
    return locked.size > 0;
  },
  holder(tenantId: string): string | null {
    return locked.get(tenantId)?.conversionId ?? null;
  },
  /** ثبت یک درخواست مالیِ در جریان؛ تابع برگشتی پایان آن را اعلام می‌کند. */
  enter(key: string): () => void {
    inflight.set(key, (inflight.get(key) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (inflight.get(key) ?? 1) - 1;
      if (n <= 0) inflight.delete(key);
      else inflight.set(key, n);
    };
  },
  inflightCount(tenantId: string, slug = ''): number {
    return (inflight.get(tenantId) ?? 0) + (slug ? (inflight.get(slugKey(slug)) ?? 0) : 0);
  },
  slugKey,
  /** پس از قفل‌کردن، تا اتمام درخواست‌های مالیِ در جریان (حداکثر timeoutMs) صبر می‌کند. true = تخلیه شد. */
  async drain(tenantId: string, slug: string, timeoutMs = 30_000, pollMs = 100): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (writeLock.inflightCount(tenantId, slug) > 0) {
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return true;
  },
  _reset(): void {
    locked.clear();
    slugToTenant.clear();
    inflight.clear();
  },
};

/** بخش‌های اول مسیر (بعد از /api) که نوشتن مالی دارند. */
const FINANCIAL_SEGMENTS = new Set([
  'sales', 'purchasing', 'accounting', 'checks', 'warehouse', 'hr', 'recruitment', 'crm', 'contracts', 'projects', 'proposals',
  'online-store', 'events', 'booking', 'mentoring', 'ration-lab', 'referral-marketing', 'marketing', 'tax', 'dispatch',
  'production', 'book-store', 'payment-gateway', 'approvals', 'sync', 'mcp', 'ai-actions', 'public', 'quality-control',
]);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** آیا این درخواست باید هنگام قفل مسدود شود؟ */
export function isBlockedDuringConversion(method: string, path: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  const segs = path.split('?')[0]!.split('/').filter(Boolean);
  if (segs[0] === 'api') segs.shift();
  const first = segs[0];
  if (!first) return false;
  if (first === 'settings') return segs[1] === 'currencies';
  return FINANCIAL_SEGMENTS.has(first);
}
