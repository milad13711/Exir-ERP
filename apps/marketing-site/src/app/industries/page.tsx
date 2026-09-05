import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicIndustryTemplates, fetchPublicModules } from "@/lib/api";
import { deriveModulePricing, sumPricing } from "@/lib/pricing";
import { formatToman } from "@/lib/persian";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "اکسیر ERP برای هر صنف — نرم‌افزار یکپارچه‌ی متناسب با کسب‌وکار شما",
  description:
    "اکسیر ERP برای صنف‌های خوراک دام، خرده‌فروشی، رستوران و کافی‌شاپ، خدمات فنی، پخش و توزیع مویرگی و تعمیرگاه خودرو، با قالب و قیمت‌گذاری اختصاصی هر صنف.",
};

export default async function IndustriesPage() {
  const [industries, modules] = await Promise.all([
    fetchPublicIndustryTemplates().catch(() => []),
    fetchPublicModules().catch(() => []),
  ]);
  const priceByCode = new Map(modules.map((m) => [m.code, deriveModulePricing(m.priceMonthly)]));

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 text-white">
        <div className="max-w-[1100px] mx-auto px-6 py-16 text-center">
          <h1 className="text-[28px] sm:text-[34px] font-extrabold leading-[1.5]">اکسیر ERP برای هر صنف</h1>
          <p className="mt-4 text-[14.5px] text-white/85 max-w-[640px] mx-auto leading-loose">
            هر قالب صنفی، نقش‌های سازمانی، کدینگ حسابداری و ماژول‌های پیش‌فرض متناسب با همان کسب‌وکار را از روز اول
            آماده دارد — و کاملاً براساس DNA و فرایندهای واقعی سازمان شما شخصی‌سازی می‌شود.
          </p>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-14">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {industries.map((t) => {
            const bundlePrice = sumPricing(
              t.defaultModules.map((c) => priceByCode.get(c)).filter((p): p is NonNullable<typeof p> => p != null),
            );
            return (
              <Link
                key={t.code}
                href={`/industries/${t.code}`}
                className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-3 hover:border-primary transition-colors"
              >
                <div className="w-11 h-11 rounded-xl" style={{ background: t.suggestedThemeColor ?? "#4338ca" }} />
                <div className="text-[15.5px] font-extrabold">{t.name}</div>
                <p className="text-[12.5px] text-muted leading-relaxed flex-1">{t.description}</p>
                <div className="text-[11.5px] text-muted">{t.defaultModules.length} ماژول پیش‌فرض</div>
                {bundlePrice.monthly > 0 && (
                  <div className="text-[13px] font-extrabold text-primary">
                    از {formatToman(bundlePrice.monthly)} در ماه
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
