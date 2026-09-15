import Link from "next/link";
import { EXIR_PRODUCTS, EXIR_INFRASTRUCTURE } from "@/lib/content";

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
              <Link href="/configure" className="hover:text-white transition-colors">
                درخواست مشاوره و تماس با ما
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 py-5 text-[11.5px] flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {year} اکسیر — همه‌ی حقوق محفوظ است.</span>
        </div>
      </div>
    </footer>
  );
}
