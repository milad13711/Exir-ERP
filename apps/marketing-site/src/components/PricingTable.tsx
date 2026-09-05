import { formatToman, formatUsd } from "@/lib/persian";
import { roundTomanToNiceNumber, type PriceDisplay, type TomanPricing } from "@/lib/pricing";

/**
 * discountPercent اختیاری است و هیچ‌جای سایت فعلاً مقداردهی نمی‌شود — فقط
 * ظرفیت بصری تخفیف را از قبل آماده نگه می‌دارد: وقتی روزی صاحب محصول
 * بخواهد تخفیف بدهد، کافی است این عدد را برای همان صفحه ست کند، بدون
 * نیاز به بازطراحی چیدمان (قیمت اصلی خط‌خورده + قیمت جدید برجسته + نشان
 * درصد تخفیف).
 */
function PriceBlock({
  price,
  discountPercent,
  big,
}: {
  price: PriceDisplay;
  discountPercent?: number;
  big?: boolean;
}) {
  if (!discountPercent) {
    return (
      <>
        <div className="text-[11px] text-muted font-bold" dir="ltr">
          {formatUsd(price.usd)}
        </div>
        <div className={big ? "text-[20px] font-extrabold" : "text-[16px] font-extrabold"}>
          {formatToman(price.toman)}
        </div>
      </>
    );
  }

  const factor = 1 - discountPercent / 100;
  const discountedUsd = Math.round(price.usd * factor);
  const discountedToman = roundTomanToNiceNumber(price.toman * factor);
  return (
    <>
      <div className="flex items-center gap-1.5" dir="ltr">
        <span className="text-[11px] text-muted line-through">{formatUsd(price.usd)}</span>
        <span className="text-[11px] text-success font-bold">{formatUsd(discountedUsd)}</span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`${big ? "text-[20px]" : "text-[16px]"} font-extrabold text-success`}>
          {formatToman(discountedToman)}
        </span>
        <span className="text-[11px] text-muted line-through">{formatToman(price.toman)}</span>
      </div>
    </>
  );
}

export function PricingTable({
  pricing,
  title,
  discountPercent,
  annualSupport,
}: {
  pricing: TomanPricing;
  title?: string;
  discountPercent?: number;
  /** پشتیبانی سالانه‌ی پس از خرید لایسنس — مبلغ ثابت سازمانی (۱۹۹$)، مستقل از تعداد ماژول. */
  annualSupport?: PriceDisplay;
}) {
  if (pricing.monthly.toman === 0) {
    return (
      <div className="bg-success-soft text-success rounded-2xl p-5 text-center font-extrabold text-[15px]">
        این ماژول رایگان و همیشه فعال است
      </div>
    );
  }

  return (
    <div>
      {title ? <div className="text-[13px] font-bold text-ink-soft mb-3">{title}</div> : null}
      {discountPercent ? (
        <div className="inline-flex items-center gap-1.5 bg-success-soft text-success text-[11.5px] font-extrabold px-3 py-1.5 rounded-full mb-3">
          🎉 {discountPercent}٪ تخفیف ویژه
        </div>
      ) : null}
      <div className="grid sm:grid-cols-3 gap-3.5">
        <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-1.5">
          <div className="text-[11.5px] font-bold text-muted">اشتراک ماهانه</div>
          <PriceBlock price={pricing.monthly} discountPercent={discountPercent} big />
          <div className="text-[11px] text-muted">در ماه</div>
        </div>
        <div className="bg-primary-soft border border-primary/20 rounded-2xl p-5 flex flex-col gap-1.5 relative">
          <div className="absolute -top-2.5 right-4 bg-primary text-white text-[10px] font-bold px-2.5 py-1 rounded-full">
            دو ماه رایگان
          </div>
          <div className="text-[11.5px] font-bold text-primary">اشتراک سالانه</div>
          <PriceBlock price={pricing.yearly} discountPercent={discountPercent} big />
          <div className="text-[11px] text-muted">در سال — به‌جای {formatToman(pricing.monthly.toman * 12)}</div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-1.5">
          <div className="text-[11.5px] font-bold text-muted">خرید لایسنس دائمی</div>
          <PriceBlock price={pricing.license} discountPercent={discountPercent} big />
          <div className="text-[11px] text-muted">
            یک‌بار پرداخت
            {annualSupport ? (
              <>
                {" "}
                + {formatToman(annualSupport.toman)} (
                <span dir="ltr">{formatUsd(annualSupport.usd)}</span>) پشتیبانی سالانه
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
