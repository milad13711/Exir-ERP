"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, HeartIcon, StarIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { API_URL, submitPublicStoreReview, ApiError, type PublicStoreProductDetail, type PublicStoreProduct } from "@/lib/api";
import { getSessionToken, addToCart, getCart, cartCount } from "@/lib/store-cart";
import { getWishlist, toggleWishlist } from "@/lib/store-wishlist";
import { CartButton } from "../../CartButton";
import { RatingStars, PriceBlock } from "../../StoreUI";

type ProductWithUrls = PublicStoreProductDetail & { images: string[] };
type RelatedWithUrls = PublicStoreProduct & { images: string[] };

function ReviewForm({ slug, productSlug, onSubmitted }: { slug: string; productSlug: string; onSubmitted: () => void }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await submitPublicStoreReview(slug, productSlug, { customerName: name.trim(), rating, comment: comment.trim() || undefined });
      setSubmitted(true);
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت نظر با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="bg-success-soft text-success text-[12.5px] font-semibold rounded-xl p-4 text-center">
        نظر شما ثبت شد و پس از تأیید نمایش داده می‌شود. ممنون از وقتی که گذاشتید 🙏
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 rounded-2xl p-4 flex flex-col gap-3">
      <div className="text-[13px] font-bold">ثبت نظر شما</div>
      <div dir="ltr" className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setRating(s)}
            onMouseEnter={() => setHoverRating(s)}
            onMouseLeave={() => setHoverRating(null)}
            className="cursor-pointer"
          >
            <StarIcon className={`w-6 h-6 ${(hoverRating ?? rating) >= s ? "text-warning fill-current" : "text-border"}`} />
          </button>
        ))}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="نام شما"
        required
        className="text-[13px] outline-none bg-white border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
      />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="نظر شما درباره‌ی این کالا (اختیاری)"
        rows={3}
        className="text-[13px] outline-none bg-white border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
      />
      {error ? <div className="text-[11.5px] text-danger">{error}</div> : null}
      <button
        type="submit"
        disabled={submitting}
        className="self-start px-5 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
      >
        {submitting ? "در حال ارسال..." : "ثبت نظر"}
      </button>
    </form>
  );
}

export function ProductClient({
  slug,
  storeName,
  product,
  relatedProducts,
}: {
  slug: string;
  storeName: string;
  product: ProductWithUrls;
  relatedProducts: RelatedWithUrls[];
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  // مقدار اولیه‌ی خنثی — دلیل را در StorefrontClient.tsx ببینید (localStorage در سرور وجود ندارد).
  const [cartCountState, setCartCountState] = useState(0);
  const [loved, setLoved] = useState(false);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const enteredAt = useRef(0);

  useEffect(() => {
    // localStorage نیست در سرور — دلیل کامل را در StorefrontClient.tsx ببینید.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCartCountState(cartCount(getCart(slug)));
    setLoved(getWishlist(slug).includes(product.id));
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
            <div className="relative aspect-square rounded-2xl bg-slate-50 overflow-hidden flex items-center justify-center">
              <button
                onClick={() => setLoved(toggleWishlist(slug, product.id).includes(product.id))}
                className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm cursor-pointer"
                aria-label="افزودن به علاقه‌مندی‌ها"
              >
                <HeartIcon className={`w-4.5 h-4.5 ${loved ? "text-danger fill-current" : "text-muted"}`} />
              </button>
              {product.discountPercent ? (
                <div className="absolute top-3 right-3 z-10 text-[11px] font-bold text-white bg-danger px-2.5 py-1 rounded-lg">
                  {product.discountPercent}٪ تخفیف
                </div>
              ) : null}
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

            <RatingStars avgRating={product.avgRating} reviewCount={product.reviewCount} size="md" />

            <PriceBlock price={product.price} compareAtPrice={product.compareAtPrice} discountPercent={product.discountPercent} size="md" />

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

        <div className="mt-14">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-extrabold">
              نظرات مشتریان
              {product.reviewCount > 0 ? <span className="text-muted font-normal"> ({toPersianDigits(product.reviewCount)})</span> : null}
            </h2>
            {!reviewFormOpen ? (
              <button onClick={() => setReviewFormOpen(true)} className="text-[12.5px] font-bold text-primary cursor-pointer">
                ثبت نظر ←
              </button>
            ) : null}
          </div>

          {reviewFormOpen ? (
            <div className="mb-6">
              <ReviewForm slug={slug} productSlug={product.slug ?? ""} onSubmitted={() => {}} />
            </div>
          ) : null}

          {product.reviews.length === 0 ? (
            <div className="text-[12.5px] text-muted">هنوز نظری برای این کالا ثبت نشده — اولین نفر باشید.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {product.reviews.map((r) => (
                <div key={r.id} className="border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[12.5px] font-bold">{r.customerName}</span>
                    <span className="text-[11px] text-muted">{formatJalaliDate(new Date(r.createdAt))}</span>
                  </div>
                  <div dir="ltr" className="flex items-center gap-0.5 text-warning mb-1.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <StarIcon key={i} className={`w-3.5 h-3.5 ${i < r.rating ? "fill-current" : "text-border"}`} />
                    ))}
                  </div>
                  {r.comment ? <p className="text-[12.5px] text-ink-soft leading-relaxed">{r.comment}</p> : null}
                </div>
              ))}
            </div>
          )}
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
                    <PriceBlock price={p.price} compareAtPrice={p.compareAtPrice} discountPercent={p.discountPercent} />
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
