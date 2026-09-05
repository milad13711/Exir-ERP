import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicModules } from "@/lib/api";
import { moduleContentOf } from "@/lib/content";
import { deriveModulePricing } from "@/lib/pricing";
import { formatToman } from "@/lib/persian";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "ماژول‌های اکسیر ERP — قیمت و امکانات هر ماژول",
  description:
    "فهرست کامل ماژول‌های اکسیر ERP با قیمت اشتراک ماهانه، سالانه و خرید لایسنس — از CRM و انبارداری تا ناوگان حمل و نقل و اتصال ایجنت هوش مصنوعی.",
};

export default async function ModulesPage() {
  const modules = await fetchPublicModules().catch(() => []);
  const byCategory = new Map<string, typeof modules>();
  for (const m of modules) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 text-white">
        <div className="max-w-[1100px] mx-auto px-6 py-16 text-center">
          <h1 className="text-[28px] sm:text-[34px] font-extrabold leading-[1.5]">ماژول‌های اکسیر ERP</h1>
          <p className="mt-4 text-[14.5px] text-white/85 max-w-[620px] mx-auto leading-loose">
            هر ماژول را جداگانه نصب کنید یا با یک قالب صنفی آماده شروع کنید — فقط برای چیزی که استفاده می‌کنید هزینه
            بدهید.
          </p>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-14">
        {[...byCategory.entries()].map(([category, list]) => (
          <div key={category} className="mb-12">
            <h2 className="text-[17px] font-extrabold mb-5 pr-3 border-r-4 border-primary">{category}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {list.map((m) => {
                const pricing = deriveModulePricing(m.priceMonthly);
                const content = moduleContentOf(m.code);
                return (
                  <Link
                    key={m.code}
                    href={`/modules/${m.code}`}
                    className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-2.5 hover:border-primary transition-colors"
                  >
                    <div className="text-[14.5px] font-extrabold">{m.name}</div>
                    {content ? (
                      <p className="text-[12px] text-primary font-semibold leading-relaxed">{content.tagline}</p>
                    ) : null}
                    <p className="text-[12px] text-muted leading-relaxed flex-1">{m.description}</p>
                    <div className="text-[12.5px] font-bold mt-1">
                      {pricing.monthly === 0 ? "رایگان" : `از ${formatToman(pricing.monthly)} در ماه`}
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
