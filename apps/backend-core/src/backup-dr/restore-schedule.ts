/**
 * زمان‌بندی چرخشی آزمون بازیابی: هر هفته مجموعه‌ی کوچکی از تننت‌ها (قدیمی‌ترین تأییدنشده‌ها) تا همه‌ی تننت‌های فعال
 * در حدود یک ماه حداقل یک بار بازیابی شوند. بار کم: ترتیبی، فقط تعداد محدود در هر هفته.
 */
export type RestoreCandidate = { slug: string; verifiedAt?: string; sinceIso: string };

export const ROTATION_DAYS = 28; // هدف: همه‌ی تننت‌ها هر ~۴ هفته
export const STALE_VERIFY_DAYS = 35; // هشدار

const DAY = 86_400_000;

export function pickRotatingTenants(candidates: RestoreCandidate[], nowMs: number, exclude: Set<string> = new Set(), opts: { rotationDays?: number; maxPerRun?: number } = {}): string[] {
  const rotation = opts.rotationDays ?? ROTATION_DAYS;
  const weeks = Math.max(1, Math.floor(rotation / 7));
  const perRun = Math.min(opts.maxPerRun ?? 25, Math.max(1, Math.ceil(candidates.length / weeks)));
  const age = (c: RestoreCandidate) => (c.verifiedAt ? Date.parse(c.verifiedAt) : -Infinity);
  return candidates
    .filter((c) => !exclude.has(c.slug))
    // فقط آن‌هایی که نوبتشان رسیده (یا هرگز تأیید نشده‌اند)؛ ۷ روز تلورانس تا هفته‌ی بعد جا نمانند
    .filter((c) => !c.verifiedAt || nowMs - Date.parse(c.verifiedAt) >= (rotation - 7) * DAY)
    .sort((a, b) => age(a) - age(b) || a.slug.localeCompare(b.slug))
    .slice(0, perRun)
    .map((c) => c.slug);
}

export function staleVerifications(candidates: RestoreCandidate[], nowMs: number, days = STALE_VERIFY_DAYS): { slug: string; ageDays: number | null; neverVerified: boolean }[] {
  const out: { slug: string; ageDays: number | null; neverVerified: boolean }[] = [];
  for (const c of candidates) {
    const base = Date.parse(c.verifiedAt ?? c.sinceIso);
    if (!Number.isFinite(base)) continue;
    const ageDays = Math.floor((nowMs - base) / DAY);
    if (ageDays > days) out.push({ slug: c.slug, ageDays, neverVerified: !c.verifiedAt });
  }
  return out;
}
