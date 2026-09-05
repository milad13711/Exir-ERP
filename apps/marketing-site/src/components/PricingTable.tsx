import { formatToman, toPersianDigits } from "@/lib/persian";
import type { TomanPricing } from "@/lib/pricing";

export function PricingTable({ pricing, title }: { pricing: TomanPricing; title?: string }) {
  if (pricing.monthly === 0) {
    return (
      <div className="bg-success-soft text-success rounded-2xl p-5 text-center font-extrabold text-[15px]">
        این ماژول رایگان و همیشه فعال است
      </div>
    );
  }

  return (
    <div>
      {title ? <div className="text-[13px] font-bold text-ink-soft mb-3">{title}</div> : null}
      <div className="grid sm:grid-cols-3 gap-3.5">
        <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-1.5">
          <div className="text-[11.5px] font-bold text-muted">اشتراک ماهانه</div>
          <div className="text-[20px] font-extrabold">{formatToman(pricing.monthly)}</div>
          <div className="text-[11px] text-muted">در ماه</div>
        </div>
        <div className="bg-primary-soft border border-primary/20 rounded-2xl p-5 flex flex-col gap-1.5 relative">
          <div className="absolute -top-2.5 right-4 bg-primary text-white text-[10px] font-bold px-2.5 py-1 rounded-full">
            {toPersianDigits(pricing.yearlySavingsPercent)}٪ صرفه‌جویی
          </div>
          <div className="text-[11.5px] font-bold text-primary">اشتراک سالانه</div>
          <div className="text-[20px] font-extrabold text-primary">{formatToman(pricing.yearly)}</div>
          <div className="text-[11px] text-muted">در سال — به‌جای {formatToman(pricing.monthly * 12)}</div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-1.5">
          <div className="text-[11.5px] font-bold text-muted">خرید لایسنس</div>
          <div className="text-[20px] font-extrabold">{formatToman(pricing.license)}</div>
          <div className="text-[11px] text-muted">یک‌بار + {formatToman(pricing.annualSupport)} پشتیبانی سالانه</div>
        </div>
      </div>
    </div>
  );
}
