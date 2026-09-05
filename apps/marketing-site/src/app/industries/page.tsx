import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicIndustryTemplates, fetchExchangeRate } from "@/lib/api";
import { licenseWeightOf, usdPricingFromLicense, sumUsdPricing, toToman } from "@/lib/pricing";
import { IndustryIllustration } from "@/components/IndustryIllustration";
import { formatToman } from "@/lib/persian";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "اکسیر ERP برای هر صنف — نرم‌افزار یکپارچه‌ی متناسب با کسب‌وکار شما",
  description:
    "اکسیر ERP برای صنف‌های خوراک دام، خرده‌فروشی، رستوران و کافی‌شاپ، خدمات فنی، پخش و توزیع مویرگی، تعمیرگاه خودرو و مشاوره کسب‌وکار، با قالب و قیمت‌گذاری اختصاصی هر صنف.",
};

export default async function IndustriesPage() {
  const [industries, rate] = await Promise.all([
    fetchPublicIndustryTemplates().catch(() => []),
    fetchExchangeRate().catch(() => ({ usdToToman: 950000, asOf: "", source: "fallback" as const })),
  ]);

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 text-white">
        <div className="max-w-[1100px] mx-auto px-6 py-16 text-center">
          <h1 className="text-[28px] sm:text-[34px] font-extrabold leading-[1.5]">اکسیر ERP برای هر صنف</h1>
          <p className="mt-4 text-[14.5px] text-white/85 max-w-[640px] mx-auto leading-loose">
            هر قالب صنفی، نقش‌های سازمانی، کدینگ حسابداری و ماژول‌های پیش‌فرض متناسب با آن صنف را از همان روز اول
            آماده دارد — و کاملاً براساس DNA و فرایندهای واقعی سازمان شما شخصی‌سازی می‌شود.
          </p>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-14">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {industries.map((t) => {
            const bundleUsd = sumUsdPricing(t.defaultModules.map((c) => usdPricingFromLicense(licenseWeightOf(c))));
            const bundlePrice = toToman(bundleUsd, rate.usdToToman);
            return (
              <Link
                key={t.code}
                href={`/industries/${t.code}`}
                className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col hover:border-primary hover:shadow-lg transition-all group"
              >
                <div className="h-[130px] overflow-hidden">
                  <IndustryIllustration code={t.code} color={t.suggestedThemeColor ?? "#4338ca"} />
                </div>
                <div className="p-6 flex flex-col gap-3 flex-1">
                  <div className="text-[15.5px] font-extrabold">{t.name}</div>
                  <p className="text-[12.5px] text-muted leading-relaxed flex-1">{t.description}</p>
                  <div className="text-[11px] text-muted">{t.defaultModules.length} ماژول پیش‌فرض</div>
                  {bundlePrice.monthly > 0 && (
                    <div className="text-[13px] font-extrabold text-primary">
                      از {formatToman(bundlePrice.monthly)} در ماه
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
