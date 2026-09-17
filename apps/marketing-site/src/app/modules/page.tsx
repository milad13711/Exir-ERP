import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicModules, fetchExchangeRate, FALLBACK_USD_TOMAN_RATE } from "@/lib/api";
import { moduleContentOf } from "@/lib/content";
import { moduleTomanPricing, FULL_LICENSE_USD, roundTomanToNiceNumber } from "@/lib/pricing";
import { CategoryVisual } from "@/components/CategoryVisual";
import { formatToman, formatUsd } from "@/lib/persian";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "ماژول‌های نرم‌افزار ERP فارسی اکسیر و قیمت هرکدام",
  description:
    "فهرست کامل ماژول‌های اکسیر ERP با قیمت اشتراک ماهانه، سالانه و خرید لایسنس — از CRM و انبارداری تا ناوگان حمل و نقل و اتصال ChatGPT/Claude.",
  alternates: { canonical: "/modules" },
};

export default async function ModulesPage() {
  const [modules, rate] = await Promise.all([
    fetchPublicModules().catch(() => []),
    fetchExchangeRate().catch(() => ({ usdToToman: FALLBACK_USD_TOMAN_RATE, asOf: "", source: "fallback" as const })),
  ]);
  const byCategory = new Map<string, typeof modules>();
  for (const m of modules) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-br from-primary-dark via-primary to-[#3d6b5b] text-white">
        <div className="max-w-[1100px] mx-auto px-6 py-16 text-center">
          <h1 className="text-[28px] sm:text-[34px] font-extrabold leading-[1.5]">ماژول‌های اکسیر ERP</h1>
          <p className="mt-4 text-[14.5px] text-white/85 max-w-[620px] mx-auto leading-loose">
            هر ماژول را جداگانه نصب کنید یا با یک قالب صنفی آماده شروع کنید — فقط برای چیزی که استفاده می‌کنید هزینه
            بدهید.
          </p>
          <div className="inline-flex flex-col items-center gap-0.5 mt-6 bg-white/15 px-5 py-2.5 rounded-2xl">
            <div className="text-[11px] text-white/70 font-semibold" dir="ltr">
              لایسنس دائمی کل مجموعه‌ی ماژول‌ها: {formatUsd(FULL_LICENSE_USD)}
            </div>
            <div className="text-[15px] font-extrabold">{formatToman(roundTomanToNiceNumber(FULL_LICENSE_USD * rate.usdToToman))}</div>
          </div>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-14">
        {[...byCategory.entries()].map(([category, list]) => (
          <div key={category} className="mb-12">
            <h2 className="text-[17px] font-extrabold mb-5 pr-3 border-r-4 border-primary">{category}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {list.map((m) => {
                const pricing = moduleTomanPricing(m.code, rate.usdToToman);
                const content = moduleContentOf(m.code);
                return (
                  <Link
                    key={m.code}
                    href={`/modules/${m.code}`}
                    className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-2.5 hover:border-primary hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <CategoryVisual category={m.category} />
                      <div className="text-[14.5px] font-extrabold">{m.name}</div>
                    </div>
                    {content ? (
                      <p className="text-[12px] text-primary font-semibold leading-relaxed">{content.tagline}</p>
                    ) : null}
                    <p className="text-[12px] text-muted leading-relaxed flex-1">{m.description}</p>
                    <div className="mt-1">
                      {pricing.monthly.toman === 0 ? (
                        <div className="text-[12.5px] font-bold">رایگان</div>
                      ) : (
                        <>
                          <div className="text-[10.5px] text-muted font-semibold" dir="ltr">
                            از {formatUsd(pricing.monthly.usd)}/ماه
                          </div>
                          <div className="text-[13.5px] font-extrabold">
                            از {formatToman(pricing.monthly.toman)} <span className="font-normal text-muted text-[11px]">در ماه</span>
                          </div>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
