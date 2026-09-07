"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SearchIcon, HeartIcon } from "@/components/icons";
import { trackPublicStoreEvent, type PublicStoreInfo, type PublicStoreProduct } from "@/lib/api";
import { getSessionToken, getCart, cartCount } from "@/lib/store-cart";
import { getWishlist, toggleWishlist } from "@/lib/store-wishlist";
import { CartButton } from "./CartButton";
import { RatingStars, PriceBlock } from "./StoreUI";

type ProductWithUrls = PublicStoreProduct & { images: string[] };
type SortOption = "newest" | "price-asc" | "price-desc";

const SORT_LABELS: Record<SortOption, string> = {
  newest: "جدیدترین",
  "price-asc": "ارزان‌ترین",
  "price-desc": "گران‌ترین",
};

export function StorefrontClient({
  slug,
  info,
  products,
}: {
  slug: string;
  info: PublicStoreInfo | null;
  products: ProductWithUrls[];
}) {
  // مقدار اولیه‌ی خنثی (۰ / خالی) تا با HTML سمت سرور یکی باشد — localStorage
  // در سرور وجود ندارد، پس هر مقداردهی اولیه‌ی lazy از روی آن باعث
  // hydration mismatch می‌شود؛ مقدار واقعی فقط در useEffect (بعد از mount
  // شدن در مرورگر) خوانده می‌شود.
  const [count, setCount] = useState(0);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("newest");

  useEffect(() => {
    const sessionToken = getSessionToken(slug);
    trackPublicStoreEvent(slug, { sessionToken, type: "PAGE_VIEW" }).catch(() => {});
    // localStorage نیست در سرور — این setState اولیه عمداً بعد از mount در
    // مرورگر اجرا می‌شود تا با HTML سمت سرور (مقدار خنثی ۰/[]) mismatch نشود.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCount(cartCount(getCart(slug)));
    setWishlist(getWishlist(slug));
    const onCartChange = () => setCount(cartCount(getCart(slug)));
    const onWishlistChange = () => setWishlist(getWishlist(slug));
    window.addEventListener("exir-store-cart-changed", onCartChange);
    window.addEventListener("exir-store-wishlist-changed", onWishlistChange);
    return () => {
      window.removeEventListener("exir-store-cart-changed", onCartChange);
      window.removeEventListener("exir-store-wishlist-changed", onWishlistChange);
    };
  }, [slug]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "fa"));
  }, [products]);

  const visibleProducts = useMemo(() => {
    const filtered = products.filter((p) => {
      if (category && p.category !== category) return false;
      if (query.trim() && !p.name.includes(query.trim())) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    else if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    else sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted;
  }, [products, category, query, sort]);

  return (
    <div dir="rtl" className="min-h-dvh bg-white flex flex-col">
      <header className="border-b border-border sticky top-0 bg-white/95 backdrop-blur z-20">
        <div className="max-w-[1100px] mx-auto px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {info?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={info.logoUrl} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center text-primary font-extrabold shrink-0">
                {(info?.name ?? "ف").charAt(0)}
              </div>
            )}
            <span className="font-extrabold text-[15px] truncate">{info?.name ?? "فروشگاه"}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/shop/${slug}/wishlist`}
              className="relative w-10 h-10 rounded-xl border border-border flex items-center justify-center text-ink-soft"
            >
              <HeartIcon className={`w-4.5 h-4.5 ${wishlist.length > 0 ? "text-danger fill-current" : ""}`} />
            </Link>
            <CartButton slug={slug} count={count} />
          </div>
        </div>

        {products.length > 0 ? (
          <div className="max-w-[1100px] mx-auto px-5 pb-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جستجوی کالا..."
                  className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="text-[12px] font-bold bg-slate-50 border border-border rounded-xl px-3 py-2.5 outline-none cursor-pointer shrink-0"
              >
                {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            {categories.length > 1 ? (
              <div className="flex items-center gap-2 overflow-x-auto -mx-5 px-5 pb-0.5">
                <button
                  onClick={() => setCategory(null)}
                  className={`shrink-0 text-[12px] font-bold px-3.5 py-2 rounded-xl cursor-pointer transition-colors ${
                    category === null ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
                  }`}
                >
                  همه
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`shrink-0 text-[12px] font-bold px-3.5 py-2 rounded-xl cursor-pointer transition-colors ${
                      category === c ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-5 py-8">
        {products.length === 0 ? (
          <div className="text-center text-muted text-sm py-20">فعلاً کالایی برای نمایش وجود ندارد.</div>
        ) : visibleProducts.length === 0 ? (
          <div className="text-center text-muted text-sm py-20">کالایی با این مشخصات پیدا نشد.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleProducts.map((p) => {
              const loved = wishlist.includes(p.id);
              return (
                <Link
                  key={p.id}
                  href={`/shop/${slug}/p/${p.slug}`}
                  className="group relative flex flex-col rounded-2xl border border-border overflow-hidden hover:shadow-lg hover:border-primary/30 transition-all"
                >
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setWishlist(toggleWishlist(slug, p.id));
                    }}
                    className="absolute top-2.5 left-2.5 z-10 w-8 h-8 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm cursor-pointer"
                    aria-label="افزودن به علاقه‌مندی‌ها"
                  >
                    <HeartIcon className={`w-4 h-4 ${loved ? "text-danger fill-current" : "text-muted"}`} />
                  </button>
                  {p.discountPercent ? (
                    <div className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold text-white bg-danger px-2 py-1 rounded-lg">
                      {p.discountPercent}٪-
                    </div>
                  ) : null}
                  <div className="aspect-square bg-slate-50 overflow-hidden flex items-center justify-center">
                    {p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.images[0]}
                        alt={p.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="text-muted text-[11px]">بدون تصویر</div>
                    )}
                  </div>
                  <div className="p-3.5 flex flex-col gap-1.5 flex-1">
                    <div className="text-[13px] font-bold line-clamp-2 min-h-[2.4em]">{p.name}</div>
                    <RatingStars avgRating={p.avgRating} reviewCount={p.reviewCount} />
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <PriceBlock price={p.price} compareAtPrice={p.compareAtPrice} discountPercent={p.discountPercent} />
                      {!p.inStock ? <span className="text-[10.5px] text-danger font-semibold shrink-0">ناموجود</span> : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-[11px] text-muted">
        قدرت گرفته از <span className="font-bold text-ink-soft">اکسیر ERP</span>
      </footer>
    </div>
  );
}
