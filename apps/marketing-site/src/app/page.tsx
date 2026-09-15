import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicIndustryTemplates } from "@/lib/api";
import { BRAND, GROUP_BRAND, EXIR_PRODUCTS, EXIR_INFRASTRUCTURE, HOME_FAQ, type ExirProduct } from "@/lib/content";
import { IndustryIllustration } from "@/components/IndustryIllustration";
import {
  FactoryIcon,
  HomeIcon,
  CelebrationIcon,
  SparkleScissorsIcon,
  MailPulseIcon,
  ShieldCheckIcon,
  SparkAiIcon,
  DnaIcon,
  LayersIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
} from "@/components/icons";

export const revalidate = 0;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const PRODUCT_ICON: Record<ExirProduct["icon"], typeof FactoryIcon> = {
  factory: FactoryIcon,
  home: HomeIcon,
  celebration: CelebrationIcon,
  beauty: SparkleScissorsIcon,
  mail: MailPulseIcon,
};

const TRUST_STATS = [
  { icon: LayersIcon, value: "+۳۰", label: "ماژول تخصصی در اکسیر ERP" },
  { icon: DnaIcon, value: "۴", label: "صنعت با محصول تخصصی مستقل" },
  { icon: ShieldCheckIcon, value: "۱۰۰٪", label: "پایگاه‌داده‌ی مجزا برای هر مشتری" },
  { icon: SparkAiIcon, value: "MCP", label: "اتصال مستقیم به ChatGPT و Claude" },
];

function ProductCard({ p }: { p: ExirProduct }) {
  const Icon = PRODUCT_ICON[p.icon];
  return (
    <div
      className="group relative overflow-hidden bg-surface border border-border rounded-2xl p-6 flex flex-col gap-3 transition-shadow hover:shadow-[0_20px_45px_-25px_rgba(15,23,42,0.35)]"
      style={{ borderTop: `3px solid ${p.accent}` }}
    >
      {p.status === "soon" ? (
        <span className="absolute top-5 left-6 text-[10.5px] font-bold px-2.5 py-1 rounded-full bg-warning-soft text-warning">
          به‌زودی
        </span>
      ) : null}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: `${p.accent}14`, color: p.accent }}
      >
        <Icon className="w-6 h-6" />
      </div>
      <div className="text-[16px] font-extrabold">{p.name}</div>
      <div className="text-[12.5px] font-semibold" style={{ color: p.accent }}>
        {p.audience}
      </div>
      <p className="text-[12.5px] text-muted leading-relaxed flex-1">{p.description}</p>
      {p.status === "live" ? (
        <a
          href={`https://${p.domain}`}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-[13px] font-bold cursor-pointer transition-transform group-hover:-translate-y-0.5"
          style={{ backgroundColor: p.accent }}
        >
          مشاهده‌ی {p.name}
          <ArrowLeftIcon className="w-3.5 h-3.5" />
        </a>
      ) : (
        <span className="text-center py-2.5 rounded-xl bg-slate-100 text-muted text-[13px] font-bold cursor-default font-display">
          {p.domain}
        </span>
      )}
    </div>
  );
}

export default async function HomePage() {
  const templates = await fetchPublicIndustryTemplates().catch(() => []);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <main className="flex-1">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-primary text-white">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden
        />
        <div
          className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #0369a1, transparent 70%)" }}
          aria-hidden
        />
        <div
          className="absolute -bottom-40 right-0 w-[480px] h-[480px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #4338ca, transparent 70%)" }}
          aria-hidden
        />

        <div className="relative max-w-[1100px] mx-auto px-6 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 text-[12.5px] font-bold px-4 py-1.5 rounded-full mb-7 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            یک اکسیر برای هر صنف — نه یک نرم‌افزار عمومی برای همه
          </div>
          <h1 className="font-display text-[30px] sm:text-[46px] font-extrabold leading-[1.35] text-balance">
            {GROUP_BRAND.claim}
          </h1>
          <p className="mt-5 text-[15px] sm:text-[17px] text-white/80 max-w-[640px] mx-auto leading-loose">
            {GROUP_BRAND.subClaim}
          </p>
          <div className="mt-9 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="#products"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-white text-primary text-[14.5px] font-extrabold shadow-lg cursor-pointer transition-transform hover:-translate-y-0.5"
            >
              محصول مناسب کسب‌وکار من کدام است؟
              <ChevronDownIcon className="w-4 h-4" />
            </Link>
            <a
              href="https://exirerp.ir"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl border border-white/25 text-white text-[14.5px] font-extrabold cursor-pointer hover:bg-white/10 transition-colors"
            >
              مشاهده‌ی اکسیر ERP
            </a>
          </div>

          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-5 sm:gap-8 max-w-[880px] mx-auto">
            {TRUST_STATS.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2 text-center">
                <s.icon className="w-5 h-5 text-white/60" />
                <div className="font-display text-[24px] sm:text-[28px] font-extrabold">{s.value}</div>
                <div className="text-[11.5px] text-white/70 leading-snug max-w-[140px]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product segmentation ────────────────────────────────────── */}
      <section id="products" className="max-w-[1100px] mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <span className="text-[12px] font-bold text-accent uppercase tracking-wide">محصولات اکسیر</span>
          <h2 className="font-display text-[24px] sm:text-[28px] font-extrabold mt-2">کدام اکسیر برای شماست؟</h2>
          <p className="text-[13.5px] text-muted mt-2.5 max-w-[560px] mx-auto leading-relaxed">
            صنف کسب‌وکار خودتان را انتخاب کنید — مستقیم به محصول تخصصی همان صنف می‌روید.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          {EXIR_PRODUCTS.map((p) => (
            <ProductCard key={p.code} p={p} />
          ))}
        </div>
      </section>

      {/* ── Infrastructure ──────────────────────────────────────────── */}
      <section className="border-t border-b border-border bg-slate-50">
        <div className="max-w-[1100px] mx-auto px-6 py-16">
          <h2 className="text-[18px] font-extrabold text-center mb-2">زیرساخت اکسیر</h2>
          <p className="text-[12.5px] text-muted text-center max-w-[520px] mx-auto leading-relaxed mb-8">
            یک زیرساخت مشترک که همه‌ی محصولات بالا را تغذیه می‌کند — و مستقیماً هم قابل استفاده است.
          </p>
          <div className="max-w-[720px] mx-auto bg-surface border border-border rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-5">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${EXIR_INFRASTRUCTURE.accent}14`, color: EXIR_INFRASTRUCTURE.accent }}
            >
              <MailPulseIcon className="w-7 h-7" />
            </div>
            <div className="flex-1 text-center sm:text-right">
              <div className="text-[15px] font-extrabold">{EXIR_INFRASTRUCTURE.name}</div>
              <p className="text-[12.5px] text-muted leading-relaxed mt-1">{EXIR_INFRASTRUCTURE.description}</p>
            </div>
            <a
              href={`https://${EXIR_INFRASTRUCTURE.domain}`}
              className="shrink-0 flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold cursor-pointer"
              style={{ backgroundColor: EXIR_INFRASTRUCTURE.accent }}
            >
              مشاهده‌ی {EXIR_INFRASTRUCTURE.name}
              <ArrowLeftIcon className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Why Exir (trust/differentiation) ────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <span className="text-[12px] font-bold text-accent uppercase tracking-wide">چرا اکسیر</span>
          <h2 className="font-display text-[24px] sm:text-[28px] font-extrabold mt-2">
            ساخته‌شده برای اعتماد کسب‌وکار، نه فقط یک دموی زیبا
          </h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          <div className="bg-surface border border-border rounded-2xl p-6">
            <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-4">
              <SparkAiIcon className="w-5.5 h-5.5" />
            </div>
            <div className="text-[14.5px] font-extrabold mb-2">اتصال به ChatGPT و Claude شخصی شما</div>
            <p className="text-[12.5px] text-muted leading-relaxed">
              هر عضو تیم می‌تواند ایجنت اختصاصی ChatGPT یا Claude خودش را از طریق MCP به اکسیر وصل کند و کارها را
              حتی از روی گوشی پیش ببرد — ویژگی‌ای که در هیچ ERP فارسی دیگری وجود ندارد.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6">
            <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-4">
              <DnaIcon className="w-5.5 h-5.5" />
            </div>
            <div className="text-[14.5px] font-extrabold mb-2">شخصی‌سازی کامل براساس DNA کسب‌وکار</div>
            <p className="text-[12.5px] text-muted leading-relaxed">
              برخلاف قالب‌های عمومی جهانی، اکسیر دقیقاً براساس فرایندها، کدینگ حسابداری و ساختار سازمانی واقعی شما
              پیکربندی می‌شود.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6">
            <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-4">
              <LayersIcon className="w-5.5 h-5.5" />
            </div>
            <div className="text-[14.5px] font-extrabold mb-2">کاملاً ماژولار، فقط برای آنچه لازم دارید</div>
            <p className="text-[12.5px] text-muted leading-relaxed">
              هر ماژول را جداگانه نصب یا حذف کنید — با سه حالت خرید (اشتراک ماهانه، سالانه یا خرید لایسنس) متناسب با
              بودجه‌ی کسب‌وکار شما.
            </p>
          </div>
        </div>
      </section>

      {/* ── ERP-specific deep section ───────────────────────────────── */}
      <section className="border-t border-border bg-slate-50">
        <div className="max-w-[1100px] mx-auto px-6 py-3.5 text-center">
          <span className="text-[13px] font-bold text-ink">
            بخش زیر مخصوص {BRAND.name} است — نرم‌افزار سازمانی اکسیر برای کارخانه‌ها و شرکت‌های بزرگ.
          </span>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-20">
        <h2 className="font-display text-[22px] font-extrabold text-center">قالب‌های صنفی اکسیر ERP</h2>
        <p className="text-[13.5px] text-muted text-center mt-2 max-w-[520px] mx-auto leading-relaxed">
          هر قالب، نقش‌های سازمانی، کدینگ حسابداری و ماژول‌های پیش‌فرض متناسب با آن صنف را از همان روز اول آماده دارد.
        </p>

        {templates.length === 0 ? (
          <div className="text-center text-muted text-sm mt-10">هنوز قالب صنفی منتشر نشده است.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            {templates.map((t) => (
              <div
                key={t.code}
                className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col"
              >
                <div className="h-[110px] overflow-hidden">
                  <IndustryIllustration code={t.code} color={t.suggestedThemeColor ?? "#4338ca"} />
                </div>
                <div className="p-6 flex flex-col gap-3 flex-1">
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
              </div>
            ))}
          </div>
        )}

        <div className="text-center mt-10">
          <Link href="/modules" className="text-[13px] font-bold text-accent">
            یا مشاهده‌ی کامل ماژول‌ها و قیمت هرکدام ←
          </Link>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-slate-50">
        <div className="max-w-[760px] mx-auto px-6 py-20">
          <div className="text-center mb-10">
            <span className="text-[12px] font-bold text-accent uppercase tracking-wide">پرسش‌های پرتکرار</span>
            <h2 className="font-display text-[22px] font-extrabold mt-2">هر آنچه قبل از شروع لازم است بدانید</h2>
          </div>
          <div className="flex flex-col gap-3">
            {HOME_FAQ.map((f) => (
              <details
                key={f.question}
                className="group bg-surface border border-border rounded-2xl px-5 py-4 open:shadow-sm"
              >
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none text-[14px] font-bold">
                  {f.question}
                  <ChevronDownIcon className="w-4 h-4 text-muted shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="text-[13px] text-muted leading-relaxed mt-3">{f.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
