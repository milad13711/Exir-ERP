"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatToman } from "@/lib/persian";
import { trackPublicStoreEvent, type PublicStoreInfo, type PublicStoreProduct } from "@/lib/api";
import { getSessionToken, getCart, cartCount } from "@/lib/store-cart";
import { CartButton } from "./CartButton";

type ProductWithUrls = PublicStoreProduct & { images: string[] };

export function StorefrontClient({
  slug,
  info,
  products,
}: {
  slug: string;
  info: PublicStoreInfo | null;
  products: ProductWithUrls[];
}) {
  const [count, setCount] = useState(() => cartCount(getCart(slug)));

  useEffect(() => {
    const sessionToken = getSessionToken(slug);
    trackPublicStoreEvent(slug, { sessionToken, type: "PAGE_VIEW" }).catch(() => {});
    const onChange = () => setCount(cartCount(getCart(slug)));
    window.addEventListener("exir-store-cart-changed", onChange);
    return () => window.removeEventListener("exir-store-cart-changed", onChange);
  }, [slug]);

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
          <CartButton slug={slug} count={count} />
        </div>
      </header>

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-5 py-8">
        {products.length === 0 ? (
          <div className="text-center text-muted text-sm py-20">فعلاً کالایی برای نمایش وجود ندارد.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => (
              <Link
                key={p.id}
                href={`/shop/${slug}/p/${p.slug}`}
                className="group flex flex-col rounded-2xl border border-border overflow-hidden hover:shadow-lg hover:border-primary/30 transition-all"
              >
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
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-extrabold">{formatToman(p.price)}</span>
                    {!p.inStock ? <span className="text-[10.5px] text-danger font-semibold">ناموجود</span> : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-[11px] text-muted">
        قدرت گرفته از <span className="font-bold text-ink-soft">اکسیر ERP</span>
      </footer>
    </div>
  );
}
