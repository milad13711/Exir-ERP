"use client";

import Link from "next/link";
import { toPersianDigits } from "@/lib/persian";

export function CartButton({ slug, count }: { slug: string; count: number }) {
  return (
    <Link
      href={`/shop/${slug}/cart`}
      className="relative flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl shrink-0"
    >
      سبد خرید
      {count > 0 ? (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-white text-primary text-[10.5px] font-extrabold flex items-center justify-center">
          {toPersianDigits(count)}
        </span>
      ) : null}
    </Link>
  );
}
