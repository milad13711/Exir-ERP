import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPublicIndustryTemplates, fetchPublicModules } from "@/lib/api";
import { industryContentOf, moduleContentOf, BRAND } from "@/lib/content";
import { deriveModulePricing, sumPricing } from "@/lib/pricing";
import { PricingTable } from "@/components/PricingTable";

export const revalidate = 0;

async function getIndustry(code: string) {
  const industries = await fetchPublicIndustryTemplates().catch(() => []);
  return industries.find((i) => i.code === code) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const industry = await getIndustry(code);
  if (!industry) return {};
  return {
    title: `اکسیر ERP برای ${industry.name} — نرم‌افزار یکپارچه‌ی اختصاصی این صنف`,
    description: (industryContentOf(code)?.intro ?? industry.description).slice(0, 155),
  };
}

export default async function IndustryDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [industry, modules] = await Promise.all([getIndustry(code), fetchPublicModules().catch(() => [])]);
  if (!industry) notFound();

  const content = industryContentOf(code);
  const moduleByCode = new Map(modules.map((m) => [m.code, m]));
  const defaultModules = industry.defaultModules
    .map((c) => moduleByCode.get(c))
    .filter((m): m is NonNullable<typeof m> => m != null);
  const extraModules = (content?.suggestedExtraModules ?? [])
    .filter((c) => !industry.defaultModules.includes(c))
    .map((c) => moduleByCode.get(c))
    .filter((m): m is NonNullable<typeof m> => m != null);

  const bundlePricing = sumPricing(defaultModules.map((m) => deriveModulePricing(m.priceMonthly)));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: (content?.faqs ?? []).map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <main className="flex-1">
      {content && content.faqs.length > 0 ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      ) : null}

      <section className="bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 text-white">
        <div className="max-w-[900px] mx-auto px-6 py-16">
          <div className="w-12 h-12 rounded-xl mb-5" style={{ background: industry.suggestedThemeColor ?? "#ffffff33" }} />
          <h1 className="text-[26px] sm:text-[32px] font-extrabold leading-[1.5]">اکسیر ERP برای {industry.name}</h1>
          <p className="mt-4 text-[13.5px] text-white/85 leading-loose max-w-[680px]">
            {content?.intro ?? industry.description}
          </p>
        </div>
      </section>

      <section className="max-w-[900px] mx-auto px-6 py-14 flex flex-col gap-11">
        <div>
          <h2 className="text-[16px] font-extrabold mb-4">ماژول‌های پیش‌فرض این صنف</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {defaultModules.map((m) => {
              const mc = moduleContentOf(m.code);
              return (
                <Link
                  key={m.code}
                  href={`/modules/${m.code}`}
                  className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5 hover:border-primary transition-colors"
                >
                  <div className="text-[13.5px] font-extrabold">{m.name}</div>
                  <p className="text-[11.5px] text-muted leading-relaxed">{mc?.tagline ?? m.description}</p>
                </Link>
              );
            })}
          </div>
        </div>

        {extraModules.length > 0 && (
          <div>
            <h2 className="text-[16px] font-extrabold mb-4">ماژول‌های پیشنهادی تکمیلی</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {extraModules.map((m) => {
                const mc = moduleContentOf(m.code);
                return (
                  <Link
                    key={m.code}
                    href={`/modules/${m.code}`}
                    className="bg-primary-soft border border-primary/20 rounded-xl p-4 flex flex-col gap-1.5 hover:border-primary transition-colors"
                  >
                    <div className="text-[13.5px] font-extrabold text-primary">{m.name}</div>
                    <p className="text-[11.5px] text-ink-soft leading-relaxed">{mc?.tagline ?? m.description}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-[16px] font-extrabold mb-4">قیمت‌گذاری بسته‌ی پیش‌فرض این صنف</h2>
          <PricingTable pricing={bundlePricing} title={`مجموع ${defaultModules.length} ماژول پیش‌فرض`} />
        </div>

        {content && content.faqs.length > 0 && (
          <div>
            <h2 className="text-[16px] font-extrabold mb-4">پرسش‌های متداول</h2>
            <div className="flex flex-col gap-3">
              {content.faqs.map((f) => (
                <div key={f.question} className="bg-surface border border-border rounded-xl p-4">
                  <div className="text-[13px] font-bold mb-1.5">{f.question}</div>
                  <p className="text-[12.5px] text-ink-soft leading-relaxed">{f.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-primary-soft rounded-2xl p-6 flex flex-col gap-2">
          <div className="text-[13.5px] font-extrabold text-primary">{BRAND.claim}</div>
          <p className="text-[12.5px] text-ink-soft leading-relaxed">{BRAND.subClaim}</p>
        </div>

        <Link
          href={`/configure?template=${industry.code}`}
          className="self-start bg-primary text-white text-[13.5px] font-extrabold px-6 py-3 rounded-2xl"
        >
          شروع با قالب {industry.name} ←
        </Link>
      </section>
    </main>
  );
}
