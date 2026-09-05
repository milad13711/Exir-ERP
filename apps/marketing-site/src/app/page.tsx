import Link from "next/link";
import { fetchPublicIndustryTemplates } from "@/lib/api";
import { BRAND } from "@/lib/content";

export const revalidate = 0;

export default async function HomePage() {
  const templates = await fetchPublicIndustryTemplates().catch(() => []);

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 text-white">
        <div className="max-w-[1100px] mx-auto px-6 py-20 text-center">
          <div className="inline-block bg-white/15 text-[12px] font-bold px-4 py-1.5 rounded-full mb-6">
            اولین ERP فارسی بین‌المللی با ایجنت هوش مصنوعی اختصاصی
          </div>
          <h1 className="text-[30px] sm:text-[42px] font-extrabold leading-[1.4]">
            نرم‌افزار مدیریت کسب‌وکار،
            <br />
            متناسب با DNA سازمان شما
          </h1>
          <p className="mt-5 text-[15px] sm:text-[16px] text-white/85 max-w-[620px] mx-auto leading-loose">
            {BRAND.claim}. {BRAND.subClaim}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/configure"
              className="inline-block px-7 py-3.5 rounded-2xl bg-white text-primary text-[14.5px] font-extrabold shadow-lg"
            >
              پیکربندی پلن و شروع →
            </Link>
            <Link
              href="/industries"
              className="inline-block px-7 py-3.5 rounded-2xl border border-white/40 text-white text-[14.5px] font-extrabold"
            >
              اکسیر برای صنف من چه می‌کند؟
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-16 grid sm:grid-cols-3 gap-6">
        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="text-[26px] mb-3">🤖</div>
          <div className="text-[14.5px] font-extrabold mb-2">ایجنت هوش مصنوعی شخصی هر عضو تیم</div>
          <p className="text-[12.5px] text-muted leading-relaxed">
            هر کارمند می‌تواند دستیار هوشمند اختصاصی خودش را به اکسیر وصل کند و کارها را با تأیید انسانی پیش ببرد —
            ویژگی‌ای که در هیچ ERP فارسی دیگری وجود ندارد.
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="text-[26px] mb-3">🧬</div>
          <div className="text-[14.5px] font-extrabold mb-2">شخصی‌سازی کامل براساس DNA کسب‌وکار</div>
          <p className="text-[12.5px] text-muted leading-relaxed">
            برخلاف قالب‌های عمومی جهانی، اکسیر دقیقاً براساس فرایندها، کدینگ حسابداری و ساختار سازمانی واقعی شما
            پیکربندی می‌شود.
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="text-[26px] mb-3">🧩</div>
          <div className="text-[14.5px] font-extrabold mb-2">کاملاً ماژولار، فقط برای آنچه لازم دارید</div>
          <p className="text-[12.5px] text-muted leading-relaxed">
            هر ماژول را جداگانه نصب یا حذف کنید — با سه حالت خرید (اشتراک ماهانه، سالانه یا خرید لایسنس) متناسب با
            بودجه‌ی کسب‌وکار شما.
          </p>
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
                <div className="flex items-center gap-2">
                  <Link
                    href={`/industries/${t.code}`}
                    className="flex-1 text-center py-2.5 rounded-xl border border-border text-ink-soft text-[12.5px] font-bold"
                  >
                    جزئیات صنف
                  </Link>
                  <Link
                    href={`/configure?template=${t.code}`}
                    className="flex-1 text-center py-2.5 rounded-xl bg-primary-soft text-primary text-[13px] font-bold"
                  >
                    شروع با این قالب
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-center mt-10">
          <Link href="/modules" className="text-[13px] font-bold text-primary">
            یا مشاهده‌ی کامل ماژول‌ها و قیمت هرکدام ←
          </Link>
        </div>
      </section>
    </main>
  );
}
