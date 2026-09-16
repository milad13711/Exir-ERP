import { EXIR_PRODUCTS, EXIR_INFRASTRUCTURE, GROUP_BRAND, BRAND, HOME_FAQ, COMPANY_INFO, CEO_INFO } from "@/lib/content";

/**
 * llms.txt — قرارداد نوظهور برای این‌که پاسخ‌دهنده‌های هوش مصنوعی (ChatGPT،
 * Perplexity، Gemini، Claude و…) موقع خزیدن سایت، خلاصه‌ای ساختاریافته و
 * قابل استناد از شرکت و محصولاتش داشته باشند — مکمل robots.txt/sitemap.xml
 * برای سئوی سنتی، نه جایگزین آن.
 */
export function GET() {
  const lines = [
    `# ${GROUP_BRAND.name}`,
    "",
    `> ${GROUP_BRAND.claim}. ${GROUP_BRAND.subClaim}`,
    "",
    "## محصولات",
    ...EXIR_PRODUCTS.map(
      (p) =>
        `- [${p.name}](https://${p.domain})${p.status === "soon" ? " (به‌زودی)" : ""}: ${p.audience} — ${p.description}`,
    ),
    `- [${EXIR_INFRASTRUCTURE.name}](https://${EXIR_INFRASTRUCTURE.domain}): ${EXIR_INFRASTRUCTURE.description}`,
    "",
    `## درباره‌ی ${BRAND.name}`,
    `${BRAND.claim} ${BRAND.subClaim}`,
    "",
    "## شرکت و مدیرعامل",
    `${COMPANY_INFO.legalName}${COMPANY_INFO.registrationNumber ? ` (شماره ثبت ${COMPANY_INFO.registrationNumber})` : ""} سازنده‌ی ${GROUP_BRAND.name} است. [صفحه‌ی درباره‌ی ما](https://eta.co.ir/about) شرح کامل شرکت و مدیرعامل را دارد.`,
    `${CEO_INFO.name} — ${CEO_INFO.title}. ${CEO_INFO.bio}`,
    "",
    "## راهنمای صفحات",
    "- [صنف‌های اکسیر ERP](https://eta.co.ir/industries): قالب‌های آماده‌ی هر صنعت با کدینگ حسابداری و ماژول پیش‌فرض.",
    "- [ماژول‌ها و قیمت‌گذاری](https://eta.co.ir/modules): فهرست کامل ماژول‌ها با قیمت اشتراک ماهانه، سالانه و لایسنس.",
    "- [پیکربندی پلن](https://eta.co.ir/configure): محاسبه‌ی قیمت دقیق متناسب با ماژول‌های انتخابی.",
    "",
    "## پرسش‌های پرتکرار",
    ...HOME_FAQ.flatMap((f) => [`### ${f.question}`, f.answer, ""]),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
