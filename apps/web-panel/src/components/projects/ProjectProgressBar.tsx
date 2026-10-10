import clsx from "clsx";
import { toPersianDigits } from "@/lib/persian";

/** رنگ نوار بر اساس بازه‌ی درصد: کم / متوسط / زیاد / کامل — فقط با توکن‌های طراحی. */
export function progressTone(percent: number): { bar: string; text: string; label: string } {
  if (percent >= 100) return { bar: "bg-success", text: "text-success", label: "کامل" };
  if (percent >= 67) return { bar: "bg-primary", text: "text-primary", label: "زیاد" };
  if (percent >= 34) return { bar: "bg-warning", text: "text-warning", label: "متوسط" };
  return { bar: "bg-danger", text: "text-danger", label: "کم" };
}

/**
 * نوار درصد پیشرفت پروژه (مرحله‌محور؛ محاسبه‌ی سرور). RTL: پُرشدن از راست به چپ؛ با aria-valuenow برای
 * دسترس‌پذیری. بدون مرحله → «بدون مرحله».
 */
export function ProjectProgressBar({
  percent,
  done,
  total,
  size = "md",
  className,
  hideStages = false,
}: {
  percent: number;
  done: number;
  total: number;
  size?: "sm" | "md";
  className?: string;
  hideStages?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  if (total === 0) {
    return <div className={clsx("text-[11px] text-muted", className)}>بدون مرحله</div>;
  }
  const tone = progressTone(pct);
  return (
    <div dir="rtl" className={clsx("w-full", className)}>
      <div className={clsx("flex items-center justify-between gap-2 mb-1", size === "sm" ? "text-[10.5px]" : "text-[11.5px]")}>
        <span className={clsx("font-extrabold", tone.text)}>{toPersianDigits(pct)}٪</span>
        {hideStages ? null : (
          <span className="text-muted">
            {toPersianDigits(done)} از {toPersianDigits(total)} مرحله
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`پیشرفت پروژه ${toPersianDigits(pct)} درصد`}
        className={clsx("w-full rounded-full bg-slate-100 overflow-hidden", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div className={clsx("h-full rounded-full transition-all", tone.bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
