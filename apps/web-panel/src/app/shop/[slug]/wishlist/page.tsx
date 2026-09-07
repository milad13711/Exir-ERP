"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, HeartIcon } from "@/components/icons";
import { fetchPublicStoreProducts, type PublicStoreProduct } from "@/lib/api";
import { getWishlist, toggleWishlist } from "@/lib/store-wishlist";
import { PriceBlock, RatingStars } from "../StoreUI";

export default function WishlistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [products, setProducts] = useState<(PublicStoreProduct & { images: string[] })[] | null>(null);

  useEffect(() => {
    // localStorage نیست در سرور — دلیل کامل را در StorefrontClient.tsx ببینید.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWishlistIds(getWishlist(slug));
    fetchPublicStoreProducts(slug)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [slug]);

  const items = (products ?? []).filter((p) => wishlistIds.includes(p.id));

  return (
    <div dir="rtl" className="min-h-dvh bg-white flex flex-col">
      <header className="border-b border-border sticky top-0 bg-white/95 backdrop-blur z-20">
        <div className="max-w-[1100px] mx-auto px-5 py-4 flex items-center justify-between">
          <span className="font-extrabold text-[15px]">علاقه‌مندی‌ها</span>
          <Link href={`/shop/${slug}`} className="text-[12px] text-muted font-semibold flex items-center gap-1">
            بازگشت به فروشگاه
            <ChevronDownIcon className="w-3.5 h-3.5 rotate-90" />
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-5 py-8">
        {products === null ? (
          <div className="text-center text-muted text-sm py-20">در حال بارگذاری...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-muted text-sm py-20 flex flex-col items-center gap-3">
            <HeartIcon className="w-8 h-8 text-border" />
            هنوز کالایی به علاقه‌مندی‌ها اضافه نکرده‌اید.
            <Link href={`/shop/${slug}`} className="text-primary font-bold">
              مشاهده‌ی کالاها ←
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((p) => (
              <Link
                key={p.id}
                href={`/shop/${slug}/p/${p.slug}`}
                className="group relative flex flex-col rounded-2xl border border-border overflow-hidden hover:shadow-lg hover:border-primary/30 transition-all"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setWishlistIds(toggleWishlist(slug, p.id));
                  }}
                  className="absolute top-2.5 left-2.5 z-10 w-8 h-8 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm cursor-pointer"
                >
                  <HeartIcon className="w-4 h-4 text-danger fill-current" />
                </button>
                <div className="aspect-square bg-slate-50 overflow-hidden flex items-center justify-center">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-muted text-[11px]">بدون تصویر</div>
                  )}
                </div>
                <div className="p-3.5 flex flex-col gap-1.5 flex-1">
                  <div className="text-[13px] font-bold line-clamp-2 min-h-[2.4em]">{p.name}</div>
                  <RatingStars avgRating={p.avgRating} reviewCount={p.reviewCount} />
                  <PriceBlock price={p.price} compareAtPrice={p.compareAtPrice} discountPercent={p.discountPercent} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
