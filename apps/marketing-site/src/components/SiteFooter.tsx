import Link from "next/link";
import { EXIR_PRODUCTS, EXIR_INFRASTRUCTURE, COMPANY_INFO } from "@/lib/content";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-primary text-white/70">
      <div className="max-w-[1100px] mx-auto px-6 py-14 grid sm:grid-cols-4 gap-10">
        <div className="sm:col-span-1">
          <div className="font-display text-[16px] font-extrabold text-white mb-2">اکسیر</div>
          <p className="text-[12.5px] leading-relaxed">
            شرکت مادر نرم‌افزارهای تخصصی صنفی — یک محصول اختصاصی برای هر کسب‌وکار، نه یک قالب عمومی برای همه.
          </p>
        </div>

        <div>
          <div className="text-[12px] font-bold text-white mb-3">محصولات ما</div>
          <ul className="flex flex-col gap-2 text-[12.5px]">
            {EXIR_PRODUCTS.map((p) => (
              <li key={p.code}>
                {p.status === "live" ? (
                  <a href={`https://${p.domain}`} className="hover:text-white transition-colors">
                    {p.name}
                  </a>
                ) : (
                  <span className="opacity-60">{p.name} (به‌زودی)</span>
                )}
              </li>
            ))}
            <li>
              <a href={`https://${EXIR_INFRASTRUCTURE.domain}`} className="hover:text-white transition-colors">
                {EXIR_INFRASTRUCTURE.name}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <div className="text-[12px] font-bold text-white mb-3">اکسیر ERP</div>
          <ul className="flex flex-col gap-2 text-[12.5px]">
            <li>
              <Link href="/industries" className="hover:text-white transition-colors">
                صنف‌های پشتیبانی‌شده
              </Link>
            </li>
            <li>
              <Link href="/modules" className="hover:text-white transition-colors">
                ماژول‌ها و قیمت‌گذاری
              </Link>
            </li>
            <li>
              <Link href="/configure" className="hover:text-white transition-colors">
                پیکربندی پلن
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <div className="text-[12px] font-bold text-white mb-3">ارتباط با ما</div>
          <ul className="flex flex-col gap-2 text-[12.5px]">
            <li>
              <Link href="/about" className="hover:text-white transition-colors">
                درباره‌ی ما
              </Link>
            </li>
            <li>
              <Link href="/configure" className="hover:text-white transition-colors">
                درخواست مشاوره و تماس با ما
              </Link>
            </li>
            <li dir="ltr" className="text-right font-display">
              {COMPANY_INFO.phone}
            </li>
            <li className="leading-relaxed">{COMPANY_INFO.address}</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 py-5 text-[11.5px] flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>
            © {year} {COMPANY_INFO.legalName}
            {COMPANY_INFO.registrationNumber ? ` — شماره ثبت ${COMPANY_INFO.registrationNumber}` : ""} — همه‌ی حقوق
            محفوظ است.
          </span>
          <a
            href={COMPANY_INFO.enamadBadge.verifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="origin"
            className="bg-white rounded-lg p-1 shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={COMPANY_INFO.enamadBadge.logoUrl} alt="نماد اعتماد الکترونیکی" width={64} height={64} />
          </a>
        </div>
      </div>
    </footer>
  );
}
