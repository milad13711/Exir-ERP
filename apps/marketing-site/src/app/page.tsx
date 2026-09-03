import Link from "next/link";
import { fetchPublicIndustryTemplates } from "@/lib/api";

export const revalidate = 0;

export default async function HomePage() {
  const templates = await fetchPublicIndustryTemplates().catch(() => []);

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 text-white">
        <div className="max-w-[1100px] mx-auto px-6 py-20 text-center">
          <div className="text-[34px] sm:text-[42px] font-extrabold leading-[1.4]">
            نرم‌افزار مدیریت کسب‌وکار،
            <br />
            متناسب با صنف شما
          </div>
          <p className="mt-5 text-[15px] sm:text-[16px] text-white/85 max-w-[560px] mx-auto leading-loose">
            یک قالب صنفی آماده انتخاب کنید یا ماژول‌های موردنیازتان را خودتان بچینید — فروش، انبار، حسابداری و منابع
            انسانی، همه در یک محیط فارسی و کاملاً ماژولار.
          </p>
          <Link
            href="/configure"
            className="inline-block mt-8 px-7 py-3.5 rounded-2xl bg-white text-primary text-[14.5px] font-extrabold shadow-lg"
          >
            پیکربندی پلن و شروع →
          </Link>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-16">
        <h2 className="text-[22px] font-extrabold text-center">قالب‌های صنفی</h2>
        <p className="text-[13.5px] text-muted text-center mt-2 max-w-[520px] mx-auto leading-relaxed">
          هر قالب، نقش‌های سازمانی، کدینگ حسابداری و ماژول‌های پیش‌فرض متناسب با آن صنف را از همان روز اول آماده دارد.
        </p>

        {templates.length === 0 ? (
          <div className="text-center text-muted text-sm mt-10">هنوز قالب صنفی منتشر نشده است.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            {templates.map((t) => (
              <div key={t.code} className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-3">
                <div
                  className="w-11 h-11 rounded-xl"
                  style={{ background: t.suggestedThemeColor ?? "#4338ca" }}
                />
                <div className="text-[15px] font-extrabold">{t.name}</div>
                <p className="text-[12.5px] text-muted leading-relaxed flex-1">{t.description}</p>
                <div className="text-[11px] text-muted">{t.defaultModules.length} ماژول پیش‌فرض</div>
                <Link
                  href={`/configure?template=${t.code}`}
                  className="mt-1 text-center py-2.5 rounded-xl bg-primary-soft text-primary text-[13px] font-bold"
                >
                  شروع با این قالب
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
