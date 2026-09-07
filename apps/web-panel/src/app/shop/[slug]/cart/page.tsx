"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon, ChevronDownIcon, TrashIcon } from "@/components/icons";
import { formatToman, toPersianDigits } from "@/lib/persian";
import { placePublicStoreOrder, trackPublicStoreEvent, ApiError } from "@/lib/api";
import { getSessionToken, getCart, setCartQuantity, removeFromCart, clearCart, cartTotal, type Cart } from "@/lib/store-cart";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export default function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  // مقدار اولیه‌ی خالی — دلیل را در StorefrontClient.tsx ببینید (localStorage در سرور وجود ندارد).
  const [cart, setCart] = useState<Cart>({});
  const [step, setStep] = useState<"cart" | "checkout" | "done">("cart");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState<number | null>(null);

  useEffect(() => {
    // localStorage نیست در سرور — دلیل کامل را در StorefrontClient.tsx ببینید.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCart(getCart(slug));
  }, [slug]);

  const lines = Object.values(cart);
  const total = cartTotal(cart);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const sessionToken = getSessionToken(slug);
      const res = await placePublicStoreOrder(slug, {
        customerName: name.trim(),
        customerPhone: phone.trim(),
        shippingAddress: address.trim(),
        notes: notes.trim() || undefined,
        sessionToken,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      });
      trackPublicStoreEvent(slug, { sessionToken, type: "ORDER_PLACED", meta: { orderNo: res.orderNo } }).catch(() => {});
      clearCart(slug);
      setOrderNo(res.orderNo);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت سفارش با خطا مواجه شد، لطفاً دوباره تلاش کنید");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <div dir="rtl" className="min-h-dvh bg-white flex items-center justify-center px-5">
        <div className="max-w-[420px] w-full text-center bg-success-soft rounded-3xl p-8">
          <CheckIcon className="w-10 h-10 text-success mx-auto mb-3" />
          <div className="text-[16px] font-extrabold text-success mb-1.5">سفارش شما ثبت شد</div>
          <div className="text-[13px] text-ink-soft leading-relaxed">
            شماره سفارش: <span className="font-extrabold">#{toPersianDigits(orderNo ?? 0)}</span>
            <br />
            به‌زودی برای هماهنگی ارسال با شما تماس گرفته می‌شود.
          </div>
          <Link href={`/shop/${slug}`} className="inline-block mt-5 text-[13px] font-bold text-primary">
            بازگشت به فروشگاه ←
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-white flex flex-col">
      <header className="border-b border-border sticky top-0 bg-white/95 backdrop-blur z-20">
        <div className="max-w-[700px] mx-auto px-5 py-4 flex items-center justify-between">
          <span className="font-extrabold text-[15px]">{step === "cart" ? "سبد خرید" : "تکمیل سفارش"}</span>
          <Link href={`/shop/${slug}`} className="text-[12px] text-muted font-semibold flex items-center gap-1">
            ادامه خرید
            <ChevronDownIcon className="w-3.5 h-3.5 rotate-90" />
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-[700px] w-full mx-auto px-5 py-8">
        {lines.length === 0 && step === "cart" ? (
          <div className="text-center text-muted text-sm py-20">
            سبد خرید شما خالی است.
            <br />
            <Link href={`/shop/${slug}`} className="text-primary font-bold mt-3 inline-block">
              مشاهده‌ی کالاها ←
            </Link>
          </div>
        ) : step === "cart" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              {lines.map((l) => (
                <div key={l.productId} className="flex items-center gap-3 border border-border rounded-2xl p-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate">{l.name}</div>
                    <div className="text-[12px] text-muted mt-0.5">{formatToman(l.price)}</div>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-2.5 py-1.5 shrink-0">
                    <button
                      onClick={() => setCart(setCartQuantity(slug, l.productId, l.quantity + 1))}
                      className="w-6 h-6 rounded-lg bg-white border border-border flex items-center justify-center cursor-pointer font-bold text-[13px]"
                    >
                      +
                    </button>
                    <span className="text-[13px] font-extrabold w-5 text-center">{toPersianDigits(l.quantity)}</span>
                    <button
                      onClick={() => setCart(setCartQuantity(slug, l.productId, l.quantity - 1))}
                      className="w-6 h-6 rounded-lg bg-white border border-border flex items-center justify-center cursor-pointer font-bold text-[13px]"
                    >
                      −
                    </button>
                  </div>
                  <div className="text-[13px] font-extrabold w-24 text-left shrink-0">{formatToman(l.price * l.quantity)}</div>
                  <button
                    onClick={() => setCart(removeFromCart(slug, l.productId))}
                    className="text-muted hover:text-danger cursor-pointer shrink-0"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-[15px] font-extrabold pt-3 border-t border-border">
              <span>جمع کل</span>
              <span>{formatToman(total)}</span>
            </div>

            <button
              onClick={() => setStep("checkout")}
              className="w-full py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer"
            >
              ادامه و ثبت سفارش
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between text-[13px] font-bold">
              <span>{toPersianDigits(lines.length)} قلم کالا</span>
              <span>{formatToman(total)}</span>
            </div>

            <div>
              <label className={labelClass}>نام و نام خانوادگی</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>شماره موبایل</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                inputMode="numeric"
                placeholder="09xxxxxxxxx"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>آدرس دقیق ارسال</label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>یادداشت (اختیاری)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>

            {error ? <div className="text-[12px] text-danger">{error}</div> : null}

            <p className="text-[11px] text-muted leading-relaxed">
              پرداخت این سفارش آنلاین نیست — پس از ثبت، همکاران ما برای هماهنگی نهایی و پرداخت با شما تماس می‌گیرند.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? "در حال ثبت..." : "ثبت نهایی سفارش"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
