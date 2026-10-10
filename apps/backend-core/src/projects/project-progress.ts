/**
 * محاسبه‌ی درصد پیشرفت پروژه از روی مراحل — تنها منبع حقیقت برای لیست، جزئیات، داشبورد و لینک عمومی.
 *
 * قواعد:
 *  - مرحله‌ی «انجام‌شده» (DONE) ۱۰۰٪ حساب می‌شود؛ مرحله‌ی در حال اجرا ۰٪ (مدل، پیشرفت درونی مرحله ندارد
 *    مگر مقدار `progress` (۰ تا ۱۰۰) داده شده باشد).
 *  - مرحله‌های لغو/ردشده‌ی عمداً حذف‌شده (CANCELLED / SKIPPED) از مخرج کنار گذاشته می‌شوند.
 *  - اگر مرحله‌ها وزن مثبت دارند (weight) وزن‌دار، وگرنه وزن برابر.
 *  - بدون مرحله = ۰٪ و `hasStages=false`.
 */
export type ProgressStage = {
  status: string;
  /** وزن/برآورد تلاش؛ نبود یا غیرمثبت = وزن برابر (۱) */
  weight?: number | null;
  /** پیشرفت درونی مرحله‌ی در حال اجرا (۰ تا ۱۰۰)؛ فقط برای IN_PROGRESS در نظر گرفته می‌شود */
  progress?: number | null;
};

export type ProjectProgress = {
  /** عدد صحیح ۰ تا ۱۰۰ */
  progressPercent: number;
  doneStages: number;
  /** مرحله‌های شمارش‌شده در مخرج (بدون لغو/ردشده‌ی عمدی) */
  totalStages: number;
  hasStages: boolean;
};

export const EXCLUDED_STAGE_STATUSES: readonly string[] = ['CANCELLED', 'SKIPPED'];

export function computeProjectProgress(stages: readonly ProgressStage[]): ProjectProgress {
  const counted = stages.filter((s) => !EXCLUDED_STAGE_STATUSES.includes(s.status));
  if (counted.length === 0) return { progressPercent: 0, doneStages: 0, totalStages: 0, hasStages: false };

  // وزن‌دار فقط وقتی حداقل یک مرحله وزن مثبت دارد؛ مرحله‌ی بی‌وزن در این حالت وزن میانگین نمی‌گیرد بلکه ۱.
  const anyWeighted = counted.some((s) => typeof s.weight === 'number' && Number.isFinite(s.weight) && s.weight > 0);
  const weightOf = (s: ProgressStage) => (anyWeighted && typeof s.weight === 'number' && Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 1);

  let total = 0;
  let earned = 0;
  let done = 0;
  for (const s of counted) {
    const w = weightOf(s);
    total += w;
    if (s.status === 'DONE') {
      earned += w;
      done += 1;
    } else if (s.status === 'IN_PROGRESS' && typeof s.progress === 'number' && Number.isFinite(s.progress)) {
      earned += w * (Math.min(100, Math.max(0, s.progress)) / 100);
    }
  }
  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { progressPercent: Math.min(100, Math.max(0, pct)), doneStages: done, totalStages: counted.length, hasStages: true };
}
