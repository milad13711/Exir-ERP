"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CheckIcon } from "@/components/icons";
import { HeroBand } from "@/components/Ornaments";
import { submitResellerApplication, fetchResellerMap, ApiError, type ProductCode, type ResellerMapPin } from "@/lib/api";
import { IRAN_MAP_VIEWBOX, IRAN_PROVINCES, IRAN_CITY_DATA, IRAN_CITIES, PRODUCT_LABELS, PRODUCT_THEME } from "@/lib/iran-map";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12.5px] font-semibold mb-1.5 block";

const PRODUCTS: ProductCode[] = ["ERP", "REAL_ESTATE", "SMS_GATEWAY"];
const ALL_FILTER = "ALL" as const;

export function CollaborateClient() {
  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <HeroBand>
        <div className="max-w-[900px] mx-auto px-6 pt-14 pb-14 text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold">همکاری با ما</h1>
          <p className="text-[15px] text-white/80 mt-3 leading-loose max-w-[560px] mx-auto">
            به شبکه‌ی نمایندگان فروش محصولات اکسیر بپیوندید — هر مشتری جدیدی که معرفی کنید، از پرداخت اول و تمدیدهایش
            کمیسیون می‌گیرید. پس از بررسی درخواست شما، دسترسی به پنل نمایندگی فعال می‌شود.
          </p>
        </div>
      </HeroBand>

      {/* نقشه و فرم کنار هم (دسکتاپ)؛ در موبایل زیر هم: اول نقشه، بعد فرم */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-6 py-10 grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
        <ResellerMap />
        <div>
          <ApplicationForm />
        </div>
      </section>
    </div>
  );
}

const PIN_GAP = 15; // فاصله‌ی افقی دو پینِ هم‌شهر، در واحد viewBox

function ResellerMap() {
  const [filter, setFilter] = useState<ProductCode | typeof ALL_FILTER>(ALL_FILTER);
  const [pins, setPins] = useState<ResellerMapPin[] | null>(null);
  const [selected, setSelected] = useState<ResellerMapPin | null>(null);
  const [hoverProvince, setHoverProvince] = useState<string | null>(null);

  useEffect(() => {
    fetchResellerMap(filter === ALL_FILTER ? undefined : filter)
      .then((list) => {
        setPins(list);
        setSelected(null);
      })
      .catch(() => setPins([]));
  }, [filter]);

  // پین‌ها را شهر‌به‌شهر گروه می‌کنیم؛ اگر در یک شهر بیش از یک نماینده باشد، هرکدام پین جدا و کنار هم می‌گیرد.
  const placed = useMemo(() => {
    const byCity = new Map<string, ResellerMapPin[]>();
    for (const p of pins ?? []) {
      if (!IRAN_CITY_DATA[p.city]) continue;
      byCity.set(p.city, [...(byCity.get(p.city) ?? []), p]);
    }
    const out: Array<{ pin: ResellerMapPin; x: number; y: number }> = [];
    for (const [city, list] of byCity) {
      const c = IRAN_CITY_DATA[city];
      list.forEach((pin, i) => out.push({ pin, x: c.x + (i - (list.length - 1) / 2) * PIN_GAP, y: c.y }));
    }
    // پین‌های پایین‌تر روی بالاتری‌ها می‌افتند — ترتیب رسم بر اساس y
    return out.sort((a, b) => a.y - b.y);
  }, [pins]);

  const countByProvince = useMemo(() => {
    const m = new Map<string, number>();
    for (const { pin } of placed) {
      const prov = IRAN_CITY_DATA[pin.city]?.province;
      if (prov) m.set(prov, (m.get(prov) ?? 0) + 1);
    }
    return m;
  }, [placed]);

  const cityCount = new Set(placed.map((p) => p.pin.city)).size;
  const activeProvince = hoverProvince ?? (selected ? IRAN_CITY_DATA[selected.city]?.province ?? null : null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilter(ALL_FILTER)}
          className={clsx(
            "min-h-10 text-[12.5px] font-bold px-4 rounded-xl cursor-pointer transition-colors",
            filter === ALL_FILTER ? "bg-primary text-white" : "bg-surface border border-border text-ink-soft hover:border-primary",
          )}
        >
          همه‌ی محصولات
        </button>
        {PRODUCTS.map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            aria-pressed={filter === p}
            className={clsx(
              "min-h-10 inline-flex items-center gap-2 text-[12.5px] font-bold px-4 rounded-xl cursor-pointer transition-colors",
              filter === p ? "" : "bg-surface border border-border text-ink-soft hover:border-primary",
            )}
            style={filter === p ? { backgroundColor: PRODUCT_THEME[p].accent, color: PRODUCT_THEME[p].ink } : undefined}
          >
            <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
              <PinGlyph shape={PRODUCT_THEME[p].shape} color={filter === p ? PRODUCT_THEME[p].ink : PRODUCT_THEME[p].accent} size={4.5} />
            </svg>
            {PRODUCT_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="relative rounded-3xl border border-border bg-surface overflow-hidden shadow-[0_18px_40px_-28px_rgba(0,45,42,0.5)]">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-1 text-[12px]">
          <span className="font-bold text-primary min-h-5">{activeProvince ? `استان ${activeProvince}` : "نقشه‌ی نمایندگان"}</span>
          <span className="text-muted">
            {pins === null ? "..." : `${toFa(placed.length)} نماینده در ${toFa(cityCount)} شهر`}
          </span>
        </div>

        <svg viewBox={IRAN_MAP_VIEWBOX} className="w-full h-auto block" role="group" aria-label="نقشه‌ی استان‌های ایران و نمایندگان اکسیر">
          <defs>
            <filter id="pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor="#002d2a" floodOpacity="0.45" />
            </filter>
            <filter id="map-shadow" x="-5%" y="-5%" width="110%" height="110%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#002d2a" floodOpacity="0.18" />
            </filter>
          </defs>

          {/* مرز بیرونی کشور: همه‌ی استان‌ها با خط ضخیم زیر لایه‌ی پر */}
          <g filter="url(#map-shadow)">
            {IRAN_PROVINCES.map((pv) => (
              <path key={`o-${pv.name}`} d={pv.d} fill="#f7f9ec" stroke="#006b65" strokeWidth={3.2} strokeLinejoin="round" />
            ))}
          </g>

          {/* استان‌ها با مرز مشخص؛ استان دارای نماینده پررنگ‌تر */}
          <g>
            {IRAN_PROVINCES.map((pv) => {
              const count = countByProvince.get(pv.name) ?? 0;
              const active = activeProvince === pv.name;
              return (
                <path
                  key={pv.name}
                  d={pv.d}
                  fill={active ? "#bcd3ae" : count > 0 ? "#d9e6cb" : "#f2f5e3"}
                  stroke="#4e8a83"
                  strokeWidth={0.9}
                  strokeLinejoin="round"
                  style={{ transition: "fill 0.15s ease" }}
                  onMouseEnter={() => setHoverProvince(pv.name)}
                  onMouseLeave={() => setHoverProvince((h) => (h === pv.name ? null : h))}
                >
                  <title>{pv.name}</title>
                </path>
              );
            })}
          </g>

          {/* پین‌ها */}
          <g>
            {placed.map(({ pin, x, y }) => {
              const theme = pin.productCode ? PRODUCT_THEME[pin.productCode] : PRODUCT_THEME.OTHER;
              const isSel = selected?.id === pin.id;
              return (
                <g
                  key={pin.id}
                  transform={`translate(${x}, ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${pin.name} — ${pin.city}`}
                  aria-pressed={isSel}
                  onClick={() => setSelected(isSel ? null : pin)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(isSel ? null : pin);
                    }
                  }}
                  style={{ cursor: "pointer", outline: "none" }}
                  className="group/pin"
                >
                  {isSel ? <circle r="13" fill={theme.accent} opacity="0.22" /> : null}
                  <g transform={`scale(${isSel ? 1.25 : 1})`} filter="url(#pin-shadow)" style={{ transition: "transform 0.15s ease" }}>
                    <Teardrop color={theme.accent} />
                    <circle cx="0" cy="-19" r="6.6" fill="#f7f9ec" />
                    <g transform="translate(0,-19)">
                      <PinGlyph shape={theme.shape} color={theme.accent === "#eef08b" ? "#002d2a" : theme.accent} size={3.4} />
                    </g>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {pins !== null && placed.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="bg-surface/95 border border-border text-[12.5px] text-muted px-4 py-2 rounded-xl">
              هنوز نماینده‌ی احرازشده‌ای برای این محصول ثبت نشده
            </span>
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-3 bg-surface border border-border rounded-2xl p-4 flex items-start gap-3.5" role="status">
          {selected.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.logoUrl} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
          ) : (
            <span
              className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center text-[18px] font-extrabold"
              style={{
                backgroundColor: (selected.productCode ? PRODUCT_THEME[selected.productCode] : PRODUCT_THEME.OTHER).accent,
                color: (selected.productCode ? PRODUCT_THEME[selected.productCode] : PRODUCT_THEME.OTHER).ink,
              }}
            >
              {selected.name.trim().charAt(0)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-extrabold">{selected.name}</div>
            <div className="text-[12px] text-muted mt-0.5">
              {selected.city}
              {IRAN_CITY_DATA[selected.city]?.province ? ` · استان ${IRAN_CITY_DATA[selected.city].province}` : ""}
            </div>
            {selected.productCode ? <div className="text-[11.5px] font-bold text-primary mt-1">{PRODUCT_LABELS[selected.productCode]}</div> : null}
            {selected.bio ? <p className="text-[12px] text-ink-soft leading-relaxed mt-1.5">{selected.bio}</p> : null}
            {selected.websiteUrl ? (
              <a href={selected.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[12px] font-bold text-primary underline underline-offset-2" dir="ltr">
                {selected.websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
          <button onClick={() => setSelected(null)} className="text-muted hover:text-ink text-[18px] leading-none px-1 cursor-pointer" aria-label="بستن">
            ×
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[11.5px] text-muted text-center">برای دیدن مشخصات هر نماینده، روی پین او در نقشه بزنید.</p>
      )}
    </div>
  );
}

/** پین قطره‌ای: نوک قطره دقیقاً روی مختصات شهر است. */
function Teardrop({ color }: { color: string }) {
  return (
    <path
      d="M0 0 C -4.5 -7 -11 -11.5 -11 -19 A 11 11 0 1 1 11 -19 C 11 -11.5 4.5 -7 0 0 Z"
      fill={color}
      stroke="#f7f9ec"
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  );
}

function PinGlyph({ shape, color, size }: { shape: "circle" | "diamond" | "square"; color: string; size: number }) {
  if (shape === "diamond") return <rect x={-size} y={-size} width={size * 2} height={size * 2} fill={color} transform="rotate(45)" />;
  if (shape === "square") return <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={1} fill={color} />;
  return <circle r={size} fill={color} />;
}

function toFa(n: number): string {
  return n.toLocaleString("fa-IR");
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
              style={productCode === p ? { backgroundColor: PRODUCT_THEME[p].accent, color: PRODUCT_THEME[p].ink } : undefined}
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
