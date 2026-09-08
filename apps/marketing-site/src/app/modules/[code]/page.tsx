import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPublicModules, fetchPublicIndustryTemplates, fetchExchangeRate, FALLBACK_USD_TOMAN_RATE } from "@/lib/api";
import { moduleContentOf, BRAND } from "@/lib/content";
import { moduleTomanPricing, annualSupportPricing } from "@/lib/pricing";
import { PricingTable } from "@/components/PricingTable";
import { CategoryVisual } from "@/components/CategoryVisual";

export const revalidate = 0;

async function getModule(code: string) {
  const modules = await fetchPublicModules().catch(() => []);
  return modules.find((m) => m.code === code) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const mod = await getModule(code);
  if (!mod) return {};
  const content = moduleContentOf(code);
  const title = `${mod.name} — ماژول اکسیر ERP | ${content?.tagline ?? mod.description}`;
  return {
    title,
    description: content?.painPoint.slice(0, 155) ?? mod.description,
    keywords: content?.keywords,
  };
}

export default async function ModuleDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [mod, industries, rate] = await Promise.all([
    getModule(code),
    fetchPublicIndustryTemplates().catch(() => []),
    fetchExchangeRate().catch(() => ({ usdToToman: FALLBACK_USD_TOMAN_RATE, asOf: "", source: "fallback" as const })),
  ]);
  if (!mod) notFound();

  const content = moduleContentOf(code);
  const pricing = moduleTomanPricing(code, rate.usdToToman);
  const supportPricing = annualSupportPricing(rate.usdToToman);
  const bestForIndustries = industries.filter((i) => content?.bestFor.includes(i.code));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `${mod.name} — ${BRAND.name}`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: content?.painPoint ?? mod.description,
    offers: [
      { "@type": "Offer", name: "اشتراک ماهانه", price: pricing.monthly.toman * 10, priceCurrency: "IRR" },
      { "@type": "Offer", name: "اشتراک سالانه", price: pricing.yearly.toman * 10, priceCurrency: "IRR" },
      { "@type": "Offer", name: "خرید لایسنس", price: pricing.license.toman * 10, priceCurrency: "IRR" },
    ],
  };

  return (
    <main className="flex-1">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="bg-gradient-to-br from-primary-dark via-primary to-[#3d6b5b] text-white">
        <div className="max-w-[900px] mx-auto px-6 py-16">
          <div className="flex items-center gap-4 mb-4">
            <CategoryVisual category={mod.category} size={60} />
            <div className="text-[12px] font-bold text-white/70">{mod.category}</div>
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-extrabold leading-[1.5]">{mod.name}</h1>
          {content ? <p className="mt-3 text-[15px] text-white/90 font-semibold">{content.tagline}</p> : null}
          <p className="mt-4 text-[13.5px] text-white/80 leading-loose max-w-[640px]">{mod.description}</p>
        </div>
      </section>

      <section className="max-w-[900px] mx-auto px-6 py-14 flex flex-col gap-10">
        {content ? (
          <div>
            <h2 className="text-[16px] font-extrabold mb-3">چرا این ماژول را لازم دارید؟</h2>
            <p className="text-[13.5px] text-ink-soft leading-loose bg-surface border border-border rounded-2xl p-5">
              {content.painPoint}
            </p>
          </div>
        ) : null}

        <div>
          <h2 className="text-[16px] font-extrabold mb-3">امکانات کلیدی</h2>
          <ul className="grid sm:grid-cols-2 gap-2.5">
            {mod.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13px] text-ink-soft bg-surface border border-border rounded-xl px-3.5 py-2.5">
                <span className="text-primary font-extrabold">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-[16px] font-extrabold mb-3">قیمت‌گذاری</h2>
          <PricingTable pricing={pricing} annualSupport={supportPricing} />
        </div>

        {bestForIndustries.length > 0 && (
          <div>
            <h2 className="text-[16px] font-extrabold mb-3">مناسب‌ترین صنف‌ها برای این ماژول</h2>
            <div className="flex flex-wrap gap-2.5">
              {bestForIndustries.map((i) => (
                <Link
                  key={i.code}
                  href={`/industries/${i.code}`}
                  className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2 rounded-xl hover:bg-primary hover:text-white transition-colors"
                >
                  {i.name} ←
                </Link>
              ))}
            </div>
          </div>
        )}

        <Link
          href="/configure"
          className="self-start bg-primary text-white text-[13.5px] font-extrabold px-6 py-3 rounded-2xl"
        >
          شروع با این ماژول ←
        </Link>
      </section>
    </main>
  );
}
