"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "@/components/icons";
import { formatToman, toPersianDigits } from "@/lib/persian";
import { API_URL, type PublicStoreProduct } from "@/lib/api";
import { getSessionToken, addToCart, getCart, cartCount } from "@/lib/store-cart";
import { CartButton } from "../../CartButton";

type ProductWithUrls = PublicStoreProduct & { images: string[] };

export function ProductClient({
  slug,
  storeName,
  product,
  relatedProducts,
}: {
  slug: string;
  storeName: string;
  product: ProductWithUrls;
  relatedProducts: ProductWithUrls[];
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [cartCountState, setCartCountState] = useState(() => cartCount(getCart(slug)));
  const enteredAt = useRef(0);

  useEffect(() => {
    enteredAt.current = Date.now();
    const sessionToken = getSessionToken(slug);
    fetch(`${API_URL}/public/store/${slug}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, type: "PRODUCT_VIEW", productId: product.id }),
      keepalive: true,
    }).catch(() => {});

    function sendDwell() {
      const seconds = Math.round((Date.now() - enteredAt.current) / 1000);
      if (seconds < 1) return;
      const body = JSON.stringify({ sessionToken, type: "PRODUCT_DWELL", productId: product.id, meta: { seconds } });
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon?.(`${API_URL}/public/store/${slug}/track`, blob);
    }
    window.addEventListener("pagehide", sendDwell);
    return () => {
      window.removeEventListener("pagehide", sendDwell);
      sendDwell();
    };
  }, [slug, product.id]);

  function handleAddToCart() {
    addToCart(slug, { productId: product.id, name: product.name, price: product.price }, quantity);
    const sessionToken = getSessionToken(slug);
    fetch(`${API_URL}/public/store/${slug}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, type: "ADD_TO_CART", productId: product.id, meta: { quantity } }),
      keepalive: true,
    }).catch(() => {});
    setCartCountState(cartCount(getCart(slug)));
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-white flex flex-col">
      <header className="border-b border-border sticky top-0 bg-white/95 backdrop-blur z-20">
        <div className="max-w-[1100px] mx-auto px-5 py-4 flex items-center justify-between gap-3">
          <span className="font-extrabold text-[15px] truncate">{storeName}</span>
          <CartButton slug={slug} count={cartCountState} />
        </div>
      </header>

      <main className="flex-1 max-w-[1000px] w-full mx-auto px-5 py-8">
        <Link href={`/shop/${slug}`} className="inline-flex items-center gap-1 text-[12px] text-muted font-semibold mb-5">
          <ChevronDownIcon className="w-3.5 h-3.5 rotate-90" />
          بازگشت به فروشگاه
        </Link>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="flex flex-col gap-2.5">
            <div className="aspect-square rounded-2xl bg-slate-50 overflow-hidden flex items-center justify-center">
              {product.images[activeImage] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.images[activeImage]} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <div className="text-muted text-[12px]">بدون تصویر</div>
              )}
            </div>
            {product.images.length > 1 ? (
              <div className="flex items-center gap-2">
                {product.images.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImage(i)}
                    className={`w-16 h-16 rounded-xl overflow-hidden border-2 cursor-pointer shrink-0 ${
                      i === activeImage ? "border-primary" : "border-border"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[19px] font-extrabold leading-relaxed">{product.name}</h1>
              {product.category ? <div className="text-[12px] text-muted mt-1">{product.category}</div> : null}
            </div>

            <div className="text-[22px] font-extrabold">{formatToman(product.price)}</div>

            {product.inStock ? (
              <div className="text-[12px] text-success font-semibold">موجود در انبار</div>
            ) : (
              <div className="text-[12px] text-danger font-semibold">ناموجود</div>
            )}

            {product.description ? (
              <p className="text-[13px] text-ink-soft leading-loose whitespace-pre-line">{product.description}</p>
            ) : null}

            {product.inStock ? (
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2">
                  <button
                    onClick={() => setQuantity((q) => Math.min(product.available, q + 1))}
                    className="w-7 h-7 rounded-lg bg-white border border-border flex items-center justify-center cursor-pointer font-bold"
                  >
                    +
                  </button>
                  <span className="text-[14px] font-extrabold w-6 text-center">{toPersianDigits(quantity)}</span>
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded-lg bg-white border border-border flex items-center justify-center cursor-pointer font-bold"
                  >
                    −
                  </button>
                </div>
                <button
                  onClick={handleAddToCart}
                  className="flex-1 py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer"
                >
                  {added ? "به سبد اضافه شد ✓" : "افزودن به سبد خرید"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {relatedProducts.length > 0 ? (
          <div className="mt-14">
            <h2 className="text-[15px] font-extrabold mb-4">کالاهای مشابه</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {relatedProducts.map((p) => (
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
                  <div className="p-3 flex flex-col gap-1">
                    <div className="text-[12.5px] font-bold line-clamp-2 min-h-[2.3em]">{p.name}</div>
                    <span className="text-[12.5px] font-extrabold">{formatToman(p.price)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
