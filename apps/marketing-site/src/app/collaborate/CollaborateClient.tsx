"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CheckIcon } from "@/components/icons";
import { HeroBand } from "@/components/Mandala";
import { submitResellerApplication, fetchResellerMap, ApiError, type ProductCode, type ResellerMapPin } from "@/lib/api";
import { IRAN_MAP_PATH, IRAN_MAP_VIEWBOX, IRAN_CITIES, PRODUCT_LABELS, PRODUCT_THEME } from "@/lib/iran-map";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12.5px] font-semibold mb-1.5 block";

const PRODUCTS: ProductCode[] = ["ERP", "REAL_ESTATE", "SMS_GATEWAY"];
const ALL_FILTER = "ALL" as const;

export function CollaborateClient() {
  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50">
      <HeroBand>
        <div className="max-w-[900px] mx-auto px-6 pt-14 pb-14 text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold">همکاری با ما</h1>
          <p className="text-[15px] text-white/80 mt-3 leading-loose max-w-[560px] mx-auto">
            به شبکه‌ی نمایندگان فروش محصولات اکسیر بپیوندید — هر مشتری جدیدی که معرفی کنید، از پرداخت اول و تمدیدهایش
            کمیسیون می‌گیرید. پس از بررسی درخواست شما، دسترسی به پنل نمایندگی فعال می‌شود.
          </p>
        </div>
      </HeroBand>
      <div className="h-10" />

      <ResellerMap />

      <section className="max-w-[560px] mx-auto px-6 pb-20">
        <ApplicationForm />
      </section>
    </div>
  );
}

function ResellerMap() {
  const [filter, setFilter] = useState<ProductCode | typeof ALL_FILTER>(ALL_FILTER);
  const [pins, setPins] = useState<ResellerMapPin[] | null>(null);
  const [hovered, setHovered] = useState<ResellerMapPin | null>(null);

  useEffect(() => {
    fetchResellerMap(filter === ALL_FILTER ? undefined : filter)
      .then(setPins)
      .catch(() => setPins([]));
  }, [filter]);

  const theme = filter === ALL_FILTER ? PRODUCT_THEME.OTHER : PRODUCT_THEME[filter];

  const plotted = useMemo(() => (pins ?? []).filter((p) => IRAN_CITIES[p.city]), [pins]);

  return (
    <section className="max-w-[820px] mx-auto px-6 pb-6">
      <div className="flex items-center justify-center gap-2 mb-5 flex-wrap">
        <button
          onClick={() => setFilter(ALL_FILTER)}
          className={clsx(
            "text-[12.5px] font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors",
            filter === ALL_FILTER ? "bg-primary text-white" : "bg-white border border-border text-ink-soft",
          )}
        >
          همه‌ی محصولات
        </button>
        {PRODUCTS.map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={clsx(
              "text-[12.5px] font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors",
              filter === p ? "text-white" : "bg-white border border-border text-ink-soft",
            )}
            style={filter === p ? { backgroundColor: PRODUCT_THEME[p].accent } : undefined}
          >
            {PRODUCT_LABELS[p]}
          </button>
        ))}
      </div>

      <div
        className="relative rounded-3xl border border-border overflow-hidden transition-colors"
        style={{ backgroundColor: theme.soft }}
      >
        <svg viewBox={IRAN_MAP_VIEWBOX} className="w-full h-auto" style={{ maxHeight: 560 }}>
          <path d={IRAN_MAP_PATH} fill="#ffffff" stroke={theme.accent} strokeWidth={2} strokeOpacity={0.35} />
          {plotted.map((pin) => {
            const [x, y] = IRAN_CITIES[pin.city];
            const pinTheme = pin.productCode ? PRODUCT_THEME[pin.productCode] : PRODUCT_THEME.OTHER;
            return (
              <g
                key={pin.id}
                transform={`translate(${x}, ${y})`}
                onMouseEnter={() => setHovered(pin)}
                onMouseLeave={() => setHovered((h) => (h?.id === pin.id ? null : h))}
                style={{ cursor: "pointer" }}
              >
                <PinShape shape={pinTheme.shape} color={pinTheme.accent} highlighted={hovered?.id === pin.id} />
              </g>
            );
          })}
        </svg>

        {hovered ? (
          <div className="absolute bottom-4 start-4 bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-right max-w-[280px]">
            {hovered.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hovered.logoUrl} alt={hovered.name} className="w-14 h-14 rounded-xl object-cover mb-2" />
            ) : null}
            <div className="text-[13px] font-bold">{hovered.name}</div>
            <div className="text-[11.5px] text-muted mt-0.5">{hovered.city}</div>
            {hovered.productCode ? (
              <div className="text-[11px] font-semibold mt-1" style={{ color: PRODUCT_THEME[hovered.productCode].accent }}>
                {PRODUCT_LABELS[hovered.productCode]}
              </div>
            ) : null}
            {hovered.bio ? <p className="text-[11.5px] text-ink-soft leading-relaxed mt-1.5">{hovered.bio}</p> : null}
          </div>
        ) : null}

        {pins !== null && plotted.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="bg-white/90 text-[12.5px] text-muted px-4 py-2 rounded-xl">هنوز نماینده‌ی احرازشده‌ای برای این محصول ثبت نشده</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PinShape({ shape, color, highlighted }: { shape: "circle" | "diamond" | "square"; color: string; highlighted: boolean }) {
  const size = highlighted ? 9 : 6.5;
  if (shape === "diamond") {
    return <rect x={-size} y={-size} width={size * 2} height={size * 2} fill={color} stroke="#fff" strokeWidth={1.5} transform="rotate(45)" />;
  }
  if (shape === "square") {
    return <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={2} fill={color} stroke="#fff" strokeWidth={1.5} />;
  }
  return <circle r={size} fill={color} stroke="#fff" strokeWidth={1.5} />;
}

function ApplicationForm() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [productCode, setProductCode] = useState<ProductCode>("ERP");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cityNames = useMemo(() => Object.keys(IRAN_CITIES), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitResellerApplication({
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim(),
        email: email.trim() || undefined,
        city: city || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        productCode,
        message: message.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت درخواست با خطا مواجه شد، دوباره تلاش کنید");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="bg-success-soft rounded-2xl p-6 text-center">
        <CheckIcon className="w-8 h-8 text-success mx-auto mb-2" />
        <div className="text-[15px] font-bold text-success">درخواست شما ثبت شد</div>
        <p className="text-[13px] text-ink-soft mt-1.5">همکاران ما پس از بررسی، با شما تماس می‌گیرند.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4">
      <div className="text-[15px] font-bold text-center mb-1">درخواست نمایندگی</div>

      <div>
        <label className={labelClass}>نام و نام خانوادگی</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>نام مجموعه / شرکت</label>
        <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>شماره تماس</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required dir="ltr" placeholder="09121234567" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>ایمیل (اختیاری)</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>شهر فعالیت</label>
        <select value={city} onChange={(e) => setCity(e.target.value)} className={inputClass}>
          <option value="">انتخاب کنید...</option>
          {cityNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>وبسایت (اختیاری)</label>
        <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} dir="ltr" placeholder="https://" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>روی کدام محصول اکسیر می‌خواهید فعالیت کنید؟</label>
        <div className="flex gap-2">
          {PRODUCTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProductCode(p)}
              className={clsx(
                "flex-1 text-[12px] font-bold py-2 rounded-lg border cursor-pointer transition-colors",
                productCode === p ? "text-white border-transparent" : "border-border text-ink-soft bg-white",
              )}
              style={productCode === p ? { backgroundColor: PRODUCT_THEME[p].accent } : undefined}
            >
              {PRODUCT_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={labelClass}>توضیح (اختیاری)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputClass} />
      </div>

      {error ? <div className="text-[12.5px] text-danger">{error}</div> : null}

      <button
        type="submit"
        disabled={submitting || !name.trim() || !phone.trim()}
        className="w-full py-3.5 rounded-xl bg-primary text-white text-[14px] font-bold disabled:opacity-50 cursor-pointer"
      >
        {submitting ? "در حال ثبت..." : "ثبت درخواست نمایندگی"}
      </button>
    </form>
  );
}
