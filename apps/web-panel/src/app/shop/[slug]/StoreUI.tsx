"use client";

import { StarIcon } from "@/components/icons";
import { formatToman, toPersianDigits } from "@/lib/persian";

/** ستاره‌های امتیاز — برای کارت کالا و صفحه‌ی جزئیات، هر دو. */
export function RatingStars({ avgRating, reviewCount, size = "sm" }: { avgRating: number | null; reviewCount: number; size?: "sm" | "md" }) {
  if (reviewCount === 0 || avgRating === null) return null;
  const starSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  const rounded = Math.round(avgRating);
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5 text-warning">
        {Array.from({ length: 5 }, (_, i) => (
          <StarIcon key={i} className={`${starSize} ${i < rounded ? "fill-current" : "fill-none text-border"}`} />
        ))}
      </div>
      <span className={size === "sm" ? "text-[10.5px] text-muted" : "text-[12px] text-muted"}>
        {toPersianDigits(avgRating.toFixed(1))} ({toPersianDigits(reviewCount)})
      </span>
    </div>
  );
}

/** قیمت با نشان تخفیف (اگر تخفیف داشته باشد) — قیمت کوچک خط‌خورده + قیمت اصلی بزرگ. */
export function PriceBlock({
  price,
  compareAtPrice,
  discountPercent,
  size = "sm",
}: {
  price: number;
  compareAtPrice: number | null;
  discountPercent: number | null;
  size?: "sm" | "md";
}) {
  const priceClass = size === "sm" ? "text-[13.5px]" : "text-[22px]";
  if (!compareAtPrice || !discountPercent) {
    return <span className={`${priceClass} font-extrabold`}>{formatToman(price)}</span>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`${priceClass} font-extrabold text-danger`}>{formatToman(price)}</span>
      <span className="text-[11px] text-muted line-through">{formatToman(compareAtPrice)}</span>
      <span className="text-[10.5px] font-bold text-danger bg-danger-soft px-1.5 py-0.5 rounded-md">
        {toPersianDigits(discountPercent)}٪ تخفیف
      </span>
    </div>
  );
}
