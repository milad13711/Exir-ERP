import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fetchPublicIndustryTemplates } from "@/lib/api";
import {
  GROUP_BRAND,
  EXIR_PRODUCTS,
  EXIR_INFRASTRUCTURE,
  HOME_FAQ,
  COMPANY_INFO,
  CEO_INFO,
  type ExirProduct,
} from "@/lib/content";
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
  CheckIcon,
  AwardIcon,
  BookIcon,
  MapPinIcon,
  PhoneIcon,
  ChartUpIcon,
  BoxesIcon,
  CalculatorIcon,
  PeopleIcon,
  FunnelIcon,
  ClipboardCheckIcon,
  FileSignIcon,
  CalendarCheckIcon,
  BuildingIcon,
  SealCheckIcon,
} from "@/components/icons";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "اکسیر | نرم‌افزار ERP فارسی و راهکارهای تخصصی هر صنف",
  description:
    "خانواده‌ی نرم‌افزارهای اکسیر: نرم‌افزار ERP فارسی برای کارخانه‌ها، نرم‌افزار مدیریت املاک، و نرم‌افزار سالن زیبایی و عروسی — هرکدام تخصصی برای صنف شما.",
  alternates: { canonical: "/" },
};

/** رنگ زمینه‌ی تصویر زئوس — هیرو و بخش پایانی دقیقاً همین رنگ‌اند تا لبه‌ی تصویر دیده نشود. */
const ZEUS_BG = "#0f4f49";

const PRODUCT_ICON: Record<ExirProduct["icon"], typeof FactoryIcon> = {
  factory: FactoryIcon,
  home: HomeIcon,
  celebration: CelebrationIcon,
  beauty: SparkleScissorsIcon,
  mail: MailPulseIcon,
};

const STATS = [
  { value: "+۳۰", label: "ماژول تخصصی در اکسیر ERP" },
  { value: "۴", label: "صنف با محصول مستقل" },
  { value: "۱۰۰٪", label: "پایگاه‌داده‌ی جدا برای هر مشتری" },
  { value: "MCP", label: "اتصال به ChatGPT و Claude" },
];

const CAPABILITIES = [
  { icon: ChartUpIcon, title: "فروش و فاکتور", text: "پیش‌فاکتور، فاکتور رسمی، اقساط و پرداخت آنلاین" },
  { icon: BoxesIcon, title: "انبار و موجودی", text: "رسید، حواله، چند انبار و هشدار حداقل موجودی" },
  { icon: CalculatorIcon, title: "حسابداری", text: "کدینگ استاندارد، سند خودکار و گزارش‌های مالی" },
  { icon: PeopleIcon, title: "منابع انسانی", text: "پرونده‌ی پرسنلی، جذب و استخدام و ارزیابی عملکرد" },
  { icon: FunnelIcon, title: "CRM و قیف فروش", text: "مسیر کامل سرنخ تا مشتری وفادار و کمپین‌های پیامکی" },
  { icon: ClipboardCheckIcon, title: "پروژه و وظایف", text: "مراحل پروژه، ارجاع کار و چک‌لیست روزانه‌ی تیم" },
  { icon: FileSignIcon, title: "قرارداد و امضای دیجیتال", text: "قالب با فیلد پویا و امضای دوطرفه با کد تأیید" },
  { icon: CalendarCheckIcon, title: "نوبت‌دهی و رزرو", text: "صفحه‌ی رزرو آنلاین، پیش‌پرداخت و یادآوری پیامکی" },
];

const REASONS = [
  {
    icon: DnaIcon,
    title: "منطبق با DNA کسب‌وکار شما",
    text: "به‌جای یک قالب جهانی، فرایندها، کدینگ حسابداری و ساختار سازمانی واقعی شما پیکربندی می‌شود.",
  },
  {
    icon: SparkAiIcon,
    title: "اتصال به ChatGPT و Claude",
    text: "هر عضو تیم ایجنت اختصاصی خودش را از طریق MCP به داده‌ها وصل می‌کند و حتی از روی گوشی کار را پیش می‌برد.",
  },
  {
    icon: LayersIcon,
    title: "کاملاً ماژولار",
    text: "فقط ماژول‌هایی را که لازم دارید فعال کنید؛ با اشتراک ماهانه، سالانه یا خرید لایسنس دائمی.",
  },
  {
    icon: ShieldCheckIcon,
    title: "امنیت در سطح سازمانی",
    text: "پایگاه‌داده‌ی کاملاً جدا برای هر مشتری، دسترسی نقش‌محور و ثبت همه‌ی عملیات مهم در سوابق فعالیت.",
  },
];

const STEPS = [
  { title: "صنف و ماژول‌ها را انتخاب کنید", text: "قالب صنف خودتان را بردارید؛ نقش‌ها، کدینگ و ماژول‌های پیش‌فرض آماده است." },
  { title: "با شماره موبایل شروع کنید", text: "دوره‌ی آزمایشی با تأیید پیامکی فعال می‌شود — بدون فرم طولانی." },
  { title: "هر وقت خواستید گسترش دهید", text: "ماژول‌ها را جداگانه اضافه کنید و با اشتراک یا لایسنس ادامه دهید." },
];

function SectionHeader({ eyebrow, title, text, align = "center" }: { eyebrow: string; title: string; text?: string; align?: "center" | "start" }) {
  return (
    <div className={align === "center" ? "text-center max-w-[640px] mx-auto" : "max-w-[560px]"}>
      <div className="inline-flex items-center gap-2 text-[12.5px] font-extrabold text-primary">
        <span className="w-5 h-[2px] rounded-full bg-primary" aria-hidden />
        {eyebrow}
      </div>
      <h2 className="font-display text-[26px] sm:text-[32px] font-extrabold leading-[1.45] mt-3 text-ink">{title}</h2>
      {text ? <p className="text-[14.5px] text-muted leading-loose mt-3">{text}</p> : null}
    </div>
  );
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 px-6 min-h-12 rounded-xl bg-gold text-primary-deep text-[14.5px] font-extrabold shadow-[0_10px_24px_-12px_rgba(180,155,109,0.9)] transition hover:-translate-y-0.5 hover:brightness-105"
    >
      {children}
    </Link>
  );
}

function ProductCard({ p, featured = false }: { p: ExirProduct; featured?: boolean }) {
  const Icon = PRODUCT_ICON[p.icon];
  const live = p.status === "live";
  return (
    <article
      className={`group relative bg-surface border border-border rounded-3xl p-6 sm:p-7 flex flex-col gap-4 elev-1 card-lift ${
        featured ? "lg:col-span-2" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-14 h-14 rounded-2xl bg-primary-soft text-primary flex items-center justify-center overflow-hidden shrink-0">
          {p.logoUrl ? <Image src={p.logoUrl} alt="" width={44} height={44} className="w-9 h-9 object-contain" /> : <Icon className="w-7 h-7" />}
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${live ? "bg-primary-soft text-primary" : "bg-accent-soft text-warning"}`}>
          {live ? "فعال" : "به‌زودی"}
        </span>
      </div>

      <div>
        <h3 className="text-[18px] font-extrabold text-ink">{p.name}</h3>
        <div className="text-[13px] font-bold text-primary mt-1">{p.audience}</div>
      </div>
      <p className="text-[13.5px] text-muted leading-loose flex-1">{p.description}</p>

      {featured ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] text-ink-soft">
          {["فروش و انبار", "حسابداری و مالی", "منابع انسانی", "CRM و پروژه"].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <CheckIcon className="w-4 h-4 text-primary shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
        <span className="font-display text-[12.5px] text-muted" dir="ltr">
          {p.domain}
        </span>
        {live ? (
          <a href={`https://${p.domain}`} className="inline-flex items-center gap-1.5 min-h-10 text-[13px] font-extrabold text-primary hover:gap-2.5 transition-all">
            ورود به سایت
            <ArrowLeftIcon className="w-4 h-4" />
          </a>
        ) : (
          <span className="text-[12.5px] font-bold text-muted">در حال آماده‌سازی</span>
        )}
      </div>
    </article>
  );
}

export default async function HomePage() {
  const templates = await fetchPublicIndustryTemplates().catch(() => []);
  const [erp, ...otherProducts] = EXIR_PRODUCTS;

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
    <main className="flex-1 bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden text-white" style={{ background: ZEUS_BG }}>
        <div className="relative max-w-[1180px] mx-auto px-5 sm:px-6 pt-14 sm:pt-20 lg:pt-16 pb-24 sm:pb-28">
          <div className="grid lg:grid-cols-[1fr_1.08fr] items-center gap-8 lg:gap-6">
            <div className="text-center lg:text-right">
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 text-gold text-[12.5px] font-bold px-4 py-1.5 rounded-full">
                <SealCheckIcon className="w-4 h-4" />
                {COMPANY_INFO.legalName} — شماره ثبت {COMPANY_INFO.registrationNumber}
              </div>
              <h1 className="font-display text-[31px] sm:text-[48px] font-extrabold leading-[1.3] mt-6">{GROUP_BRAND.claim}</h1>
              <p className="mt-5 text-[15.5px] sm:text-[17px] text-white/80 max-w-[600px] mx-auto lg:mx-0 leading-loose">{GROUP_BRAND.subClaim}</p>
              <div className="mt-9 flex items-center justify-center lg:justify-start gap-3 flex-wrap">
                <PrimaryButton href="/configure">
                  شروع رایگان
                  <ArrowLeftIcon className="w-4 h-4" />
                </PrimaryButton>
                <Link
                  href="#products"
                  className="inline-flex items-center gap-2 px-6 min-h-12 rounded-xl border border-white/25 text-white text-[14.5px] font-bold hover:bg-white/10 transition-colors"
                >
                  مشاهده‌ی محصولات
                  <ChevronDownIcon className="w-4 h-4" />
                </Link>
              </div>
              <ul className="mt-9 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-[12.5px] text-white/75">
                {["دارای نماد اعتماد الکترونیکی", "پشتیبانی تلفنی و آنلاین", "استقرار ابری یا اختصاصی"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <CheckIcon className="w-4 h-4 text-gold" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
              <Image
                src="/brand/exir-zeus-cloud.webp"
                alt="زئوس، نماد اکسیر، که ماژول‌های فروش، انبار، پشتیبانی، CRM، منابع انسانی و مالی را به‌هم وصل می‌کند"
                width={1264}
                height={842}
                priority
                sizes="(min-width: 1024px) 600px, 100vw"
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats (روی لبه‌ی هیرو) ───────────────────────────────────── */}
      <section className="relative z-10 -mt-14 px-5 sm:px-6">
        <div className="max-w-[1080px] mx-auto rounded-3xl overflow-hidden border border-border bg-border elev-2 grid grid-cols-2 lg:grid-cols-4 gap-px">
          {STATS.map((s) => (
            <div key={s.label} className="bg-white px-4 sm:px-6 py-6 sm:py-7 text-center">
              <div className="font-display tabular text-[28px] sm:text-[34px] font-extrabold text-primary leading-none">{s.value}</div>
              <div className="text-[12.5px] text-muted mt-2.5 leading-relaxed">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Products ─────────────────────────────────────────────────── */}
      <section id="products" className="max-w-[1180px] mx-auto px-5 sm:px-6 pt-24 pb-20">
        <SectionHeader
          eyebrow="محصولات اکسیر"
          title="برای هر صنف، یک نرم‌افزار تخصصی"
          text="صنف کسب‌وکار خودتان را پیدا کنید — هر محصول روی یک زیرساخت مشترک و امن ساخته شده است."
        />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
          <ProductCard p={erp} featured />
          {otherProducts.map((p) => (
            <ProductCard key={p.code} p={p} />
          ))}
          <ProductCard p={EXIR_INFRASTRUCTURE} />
        </div>
      </section>

      {/* ── Capabilities ─────────────────────────────────────────────── */}
      <section className="border-y border-border bg-dots">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-6 py-20">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <SectionHeader
              align="start"
              eyebrow="اکسیر ERP"
              title="یک پلتفرم برای همه‌ی واحدهای سازمان"
              text="همه‌ی واحدها روی یک داده‌ی مشترک کار می‌کنند؛ از فروش تا حسابداری، بدون دوباره‌کاری."
            />
            <Link href="/modules" className="inline-flex items-center gap-1.5 min-h-10 text-[13.5px] font-extrabold text-primary hover:gap-2.5 transition-all">
              همه‌ی ماژول‌ها و قیمت‌ها
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="bg-white border border-border rounded-2xl p-5 elev-1 card-lift">
                <span className="w-11 h-11 rounded-xl bg-primary text-gold flex items-center justify-center">
                  <c.icon className="w-5.5 h-5.5" />
                </span>
                <h3 className="text-[15px] font-extrabold mt-4 text-ink">{c.title}</h3>
                <p className="text-[12.5px] text-muted leading-relaxed mt-1.5">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Exir ─────────────────────────────────────────────────── */}
      <section className="max-w-[1180px] mx-auto px-5 sm:px-6 py-20">
        <SectionHeader eyebrow="چرا اکسیر" title="ساخته‌شده برای اعتماد کسب‌وکار، نه فقط یک دموی زیبا" />
        <div className="grid sm:grid-cols-2 gap-5 mt-12">
          {REASONS.map((r) => (
            <div key={r.title} className="flex gap-4 bg-white border border-border rounded-2xl p-6 elev-1">
              <span className="w-12 h-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <r.icon className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-[15.5px] font-extrabold text-ink">{r.title}</h3>
                <p className="text-[13px] text-muted leading-loose mt-1.5">{r.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="border-y border-border">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-6 py-20">
          <SectionHeader eyebrow="شروع در سه قدم" title="از انتخاب صنف تا کار با سیستم" />
          <ol className="grid md:grid-cols-3 gap-5 mt-12">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative bg-white border border-border rounded-2xl p-6 elev-1">
                <span className="w-10 h-10 rounded-full bg-gold text-primary-deep font-display font-extrabold flex items-center justify-center">
                  {["۱", "۲", "۳"][i]}
                </span>
                <h3 className="text-[15.5px] font-extrabold mt-4 text-ink">{step.title}</h3>
                <p className="text-[13px] text-muted leading-loose mt-1.5">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Credibility ──────────────────────────────────────────────── */}
      <section className="max-w-[1180px] mx-auto px-5 sm:px-6 py-20">
        <SectionHeader eyebrow="پشتوانه‌ی اکسیر" title="یک مجموعه‌ی ثبت‌شده، با بنیان‌گذاری شناخته‌شده" />
        <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 mt-12">
          <div className="rounded-3xl p-7 sm:p-8 text-white elev-2" style={{ background: "#17302a" }}>
            <div className="flex items-center gap-4">
              <span className="w-14 h-14 rounded-2xl bg-gold text-primary-deep flex items-center justify-center shrink-0">
                <AwardIcon className="w-7 h-7" />
              </span>
              <div>
                <div className="text-[18px] font-extrabold">{CEO_INFO.name}</div>
                <div className="text-[12.5px] text-white/70 mt-0.5">{CEO_INFO.title}</div>
              </div>
            </div>
            <p className="text-[13.5px] text-white/80 leading-loose mt-5">{CEO_INFO.expertise}</p>
            <ul className="mt-5 flex flex-col gap-3">
              {CEO_INFO.achievements.map((a) => (
                <li key={a} className="flex items-start gap-2.5 text-[13px] text-white/90 leading-relaxed">
                  <CheckIcon className="w-4.5 h-4.5 text-gold shrink-0 mt-0.5" />
                  {a}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex items-center gap-x-5 gap-y-2 flex-wrap">
              <Link href="/about" className="inline-flex items-center gap-1.5 min-h-10 text-[13px] font-extrabold text-gold hover:gap-2.5 transition-all">
                درباره‌ی ما
                <ArrowLeftIcon className="w-4 h-4" />
              </Link>
              <a
                href={CEO_INFO.book.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 min-h-10 text-[13px] font-bold text-white/80 hover:text-white"
              >
                <BookIcon className="w-4 h-4" />
                کتاب {CEO_INFO.book.title}
              </a>
            </div>
          </div>

          <div className="bg-white border border-border rounded-3xl p-7 elev-1 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <BuildingIcon className="w-5.5 h-5.5" />
              </span>
              <div>
                <div className="text-[15.5px] font-extrabold text-ink">{COMPANY_INFO.legalName}</div>
                <div className="text-[12px] text-muted">شماره ثبت {COMPANY_INFO.registrationNumber}</div>
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-[13px] text-ink-soft leading-relaxed">
              <MapPinIcon className="w-4.5 h-4.5 text-primary shrink-0 mt-0.5" />
              {COMPANY_INFO.address}
            </div>
            <a href={`tel:${COMPANY_INFO.phone}`} className="flex items-center gap-2.5 min-h-10 text-[13px] text-ink-soft hover:text-primary">
              <PhoneIcon className="w-4.5 h-4.5 text-primary shrink-0" />
              <span className="font-display" dir="ltr">
                {COMPANY_INFO.phone}
              </span>
            </a>
            <div className="mt-auto pt-4 border-t border-border flex items-center justify-between gap-3">
              <div className="text-[12.5px] text-muted leading-relaxed">دارای نماد اعتماد الکترونیکی</div>
              <a
                href={COMPANY_INFO.enamadBadge.verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="origin"
                className="bg-white border border-border rounded-xl p-1 shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={COMPANY_INFO.enamadBadge.logoUrl} alt="نماد اعتماد الکترونیکی" width={64} height={64} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Industry templates ───────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-6 py-20">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <SectionHeader
              align="start"
              eyebrow="قالب‌های صنفی"
              title="از روز اول، آماده برای صنف شما"
              text="هر قالب نقش‌های سازمانی، کدینگ حسابداری و ماژول‌های پیش‌فرض همان صنف را آماده دارد."
            />
            <Link href="/industries" className="inline-flex items-center gap-1.5 min-h-10 text-[13.5px] font-extrabold text-primary hover:gap-2.5 transition-all">
              همه‌ی صنف‌ها
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
          </div>

          {templates.length === 0 ? (
            <div className="text-center text-muted text-sm mt-10">هنوز قالب صنفی منتشر نشده است.</div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
              {templates.map((t) => (
                <article key={t.code} className="bg-white border border-border rounded-3xl overflow-hidden flex flex-col elev-1 card-lift">
                  <div className="h-[120px] overflow-hidden bg-primary-soft">
                    <IndustryIllustration code={t.code} color={t.suggestedThemeColor ?? "#254c41"} />
                  </div>
                  <div className="p-6 flex flex-col gap-3 flex-1">
                    <h3 className="text-[16px] font-extrabold text-ink">{t.name}</h3>
                    <p className="text-[13px] text-muted leading-relaxed flex-1">{t.description}</p>
                    <div className="text-[11.5px] font-bold text-primary">{t.defaultModules.length} ماژول پیش‌فرض</div>
                    <div className="flex items-center gap-2 pt-1">
                      <Link
                        href={`/industries/${t.code}`}
                        className="flex-1 inline-flex items-center justify-center min-h-11 rounded-xl border border-border text-ink-soft text-[12.5px] font-bold hover:border-primary hover:text-primary transition-colors"
                      >
                        جزئیات صنف
                      </Link>
                      <Link
                        href={`/configure?template=${t.code}`}
                        className="flex-1 inline-flex items-center justify-center min-h-11 rounded-xl bg-primary text-white text-[13px] font-bold hover:bg-primary-light transition-colors"
                      >
                        شروع با این قالب
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-[820px] mx-auto px-5 sm:px-6 py-20">
          <SectionHeader eyebrow="پرسش‌های پرتکرار" title="هر آنچه قبل از شروع لازم است بدانید" />
          <div className="flex flex-col gap-3 mt-10">
            {HOME_FAQ.map((f) => (
              <details key={f.question} className="group bg-white border border-border rounded-2xl px-5 py-4 open:elev-1 open:border-primary/30">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none text-[14.5px] font-bold text-ink min-h-8 [&::-webkit-details-marker]:hidden">
                  {f.question}
                  <span className="w-8 h-8 rounded-full bg-primary-soft text-primary flex items-center justify-center shrink-0">
                    <ChevronDownIcon className="w-4 h-4 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <p className="text-[13.5px] text-muted leading-loose mt-3">{f.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────── */}
      <section className="px-5 sm:px-6 pb-20">
        <div className="max-w-[1180px] mx-auto overflow-hidden rounded-[2rem] text-white elev-2" style={{ background: ZEUS_BG }}>
          <div className="grid md:grid-cols-2 items-center gap-6 p-8 sm:p-12">
            <div className="text-center md:text-right">
              <h2 className="font-display text-[26px] sm:text-[34px] font-extrabold leading-[1.45]">کسب‌وکارتان را روی سیستمی بسازید که برای آن طراحی شده</h2>
              <p className="mt-4 text-[14.5px] text-white/80 leading-loose">
                قیمت را متناسب با ماژول‌های موردنیازتان همین حالا ببینید، یا برای مشاوره با ما تماس بگیرید.
              </p>
              <div className="mt-7 flex items-center justify-center md:justify-start gap-3 flex-wrap">
                <PrimaryButton href="/configure">
                  پیکربندی پلن و قیمت
                  <ArrowLeftIcon className="w-4 h-4" />
                </PrimaryButton>
                <a
                  href={`tel:${COMPANY_INFO.phone}`}
                  className="inline-flex items-center gap-2 px-6 min-h-12 rounded-xl border border-white/25 text-white text-[14.5px] font-bold hover:bg-white/10 transition-colors"
                >
                  <PhoneIcon className="w-4 h-4" />
                  <span className="font-display" dir="ltr">
                    {COMPANY_INFO.phone}
                  </span>
                </a>
              </div>
            </div>
            <Image src="/brand/exir-zeus-cloud.webp" alt="" width={1264} height={842} sizes="(min-width: 768px) 540px, 100vw" className="w-full h-auto" />
          </div>
        </div>
      </section>
    </main>
  );
}
