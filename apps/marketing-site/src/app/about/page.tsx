import type { Metadata } from "next";
import { COMPANY_INFO, CEO_INFO, GROUP_BRAND } from "@/lib/content";
import { MapPinIcon, PhoneIcon, MessageIcon, InstagramIcon, BookIcon, AwardIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "درباره‌ی ما",
  description: `${COMPANY_INFO.legalName} — سازنده‌ی خانواده‌ی نرم‌افزارهای تخصصی اکسیر، به مدیرعاملی دکتر میلاد بهرامی.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: CEO_INFO.name,
    jobTitle: CEO_INFO.title,
    description: CEO_INFO.bio,
    url: CEO_INFO.personalSite,
    worksFor: { "@type": "Organization", name: COMPANY_INFO.legalName },
    award: CEO_INFO.achievements,
    sameAs: [CEO_INFO.personalSite, `https://instagram.com/${COMPANY_INFO.instagram.ceo}`],
  };

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: COMPANY_INFO.legalName,
    alternateName: GROUP_BRAND.name,
    ...(COMPANY_INFO.registrationNumber ? { taxID: COMPANY_INFO.registrationNumber } : {}),
    address: { "@type": "PostalAddress", streetAddress: COMPANY_INFO.address, addressCountry: "IR" },
    telephone: COMPANY_INFO.phone,
    founder: { "@type": "Person", name: CEO_INFO.name },
    sameAs: [`https://instagram.com/${COMPANY_INFO.instagram.company}`],
  };

  return (
    <main className="flex-1">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-primary text-white">
        <div className="max-w-[820px] mx-auto px-6 py-16 sm:py-20 text-center">
          <span className="text-[12px] font-bold text-white/60 uppercase tracking-wide">درباره‌ی ما</span>
          <h1 className="font-display text-[28px] sm:text-[36px] font-extrabold mt-2 leading-[1.4]">
            {COMPANY_INFO.legalName}
          </h1>
          <p className="mt-4 text-[15px] text-white/80 max-w-[560px] mx-auto leading-loose">
            سازنده‌ی {GROUP_BRAND.name} — خانواده‌ی نرم‌افزارهای تخصصی صنفی که پشت اکسیر ERP، اکسیراملاک و بقیه‌ی
            محصولات این مجموعه ایستاده است.
          </p>
        </div>
      </section>

      {/* ── Company ──────────────────────────────────────────────────── */}
      <section className="max-w-[820px] mx-auto px-6 py-16">
        <h2 className="font-display text-[20px] font-extrabold mb-4">شرکت</h2>
        <p className="text-[13.5px] text-ink-soft leading-loose mb-6">
          {COMPANY_INFO.legalName} سازنده‌ی {GROUP_BRAND.name} است — به‌جای یک نرم‌افزار عمومی برای همه، برای هر صنف
          یک محصول تخصصی و متناسب با DNA همان کسب‌وکار می‌سازد.
          {COMPANY_INFO.registrationNumber ? ` شماره ثبت شرکت: ${COMPANY_INFO.registrationNumber}.` : ""}
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-2xl p-5 flex items-start gap-3">
            <MapPinIcon className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <div className="text-[11.5px] font-bold text-ink-soft mb-1">آدرس دفتر مرکزی</div>
              <div className="text-[13px] leading-relaxed">{COMPANY_INFO.address}</div>
            </div>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 flex items-start gap-3">
            <PhoneIcon className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <div className="text-[11.5px] font-bold text-ink-soft mb-1">تلفن</div>
              <div className="text-[13px] font-display" dir="ltr">
                {COMPANY_INFO.phone}
              </div>
            </div>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 flex items-start gap-3">
            <MessageIcon className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <div className="text-[11.5px] font-bold text-ink-soft mb-1">سامانه‌ی اطلاع‌رسانی پیامکی</div>
              <div className="text-[13px] font-display" dir="ltr">
                {COMPANY_INFO.smsLine}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-5 flex-wrap">
          <a
            href={`https://instagram.com/${COMPANY_INFO.instagram.company}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-accent"
          >
            <InstagramIcon className="w-4 h-4" />
            اینستاگرام شرکت
          </a>
          <a
            href={`https://instagram.com/${COMPANY_INFO.instagram.exiramlak}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-accent"
          >
            <InstagramIcon className="w-4 h-4" />
            اینستاگرام اکسیراملاک
          </a>
        </div>
      </section>

      {/* ── CEO ──────────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-slate-50">
        <div className="max-w-[820px] mx-auto px-6 py-16">
          <h2 className="font-display text-[20px] font-extrabold mb-1">{CEO_INFO.name}</h2>
          <p className="text-[13px] font-semibold text-accent mb-5">{CEO_INFO.title}</p>
          <p className="text-[13.5px] text-ink-soft leading-loose mb-6">{CEO_INFO.bio}</p>

          <div className="flex flex-col gap-2.5 mb-6">
            {CEO_INFO.achievements.map((a) => (
              <div key={a} className="flex items-start gap-2.5 bg-surface border border-border rounded-xl px-4 py-3">
                <AwardIcon className="w-4.5 h-4.5 text-accent shrink-0 mt-0.5" />
                <span className="text-[13px] leading-relaxed">{a}</span>
              </div>
            ))}
          </div>

          <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <BookIcon className="w-6 h-6" />
            </div>
            <div className="flex-1 text-center sm:text-right">
              <div className="text-[14.5px] font-extrabold">کتاب «{CEO_INFO.book.title}»</div>
              <p className="text-[12.5px] text-muted leading-relaxed mt-1">{CEO_INFO.book.description}</p>
            </div>
            <a
              href={CEO_INFO.book.url}
              className="shrink-0 px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold"
            >
              مشاهده‌ی کتاب
            </a>
          </div>

          <div className="flex items-center gap-4 mt-5 flex-wrap">
            <a href={CEO_INFO.personalSite} className="text-[12.5px] font-bold text-accent">
              سایت شخصی: thisismbahrami.ir
            </a>
            <a
              href={`https://instagram.com/${COMPANY_INFO.instagram.ceo}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-accent"
            >
              <InstagramIcon className="w-4 h-4" />
              اینستاگرام
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
