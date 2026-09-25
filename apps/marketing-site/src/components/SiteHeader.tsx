import Link from "next/link";
import Image from "next/image";

const NAV = [
  { href: "/#products", label: "محصولات" },
  { href: "/industries", label: "صنف‌های اکسیر ERP" },
  { href: "/modules", label: "ماژول‌ها" },
  { href: "/collaborate", label: "همکاری با ما" },
  { href: "/about", label: "درباره‌ی ما" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-white/85 backdrop-blur-md">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="اکسیرتجارت امین — صفحه‌ی اصلی">
          <Image src="/logo-icon.png" alt="" width={38} height={38} className="rounded-full" priority />
          <span className="font-display text-[15px] sm:text-[17px] font-extrabold text-primary whitespace-nowrap">اکسیرتجارت امین</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1 text-[13px] font-semibold text-ink-soft" aria-label="منوی اصلی">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="px-3 py-2 rounded-xl hover:bg-primary-soft hover:text-primary transition-colors">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/configure"
            className="inline-flex max-[379px]:hidden items-center justify-center whitespace-nowrap min-h-11 px-3.5 sm:px-5 rounded-xl bg-gradient-to-b from-gold to-gold-dark text-primary-deep text-[13px] font-extrabold shadow-[0_6px_16px_-8px_rgba(184,137,43,0.9)] hover:brightness-105 transition"
          >
            شروع رایگان
          </Link>

          <details className="lg:hidden relative group">
            <summary
              className="list-none w-11 h-11 rounded-xl border border-border flex items-center justify-center cursor-pointer text-primary hover:bg-primary-soft transition-colors [&::-webkit-details-marker]:hidden"
              aria-label="باز کردن منو"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path className="group-open:hidden" d="M4 7h16M4 12h16M4 17h16" />
                <path className="hidden group-open:block" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </summary>
            <nav
              className="absolute end-0 top-full mt-2 w-[min(88vw,300px)] bg-white border border-border rounded-2xl shadow-2xl p-2 flex flex-col"
              aria-label="منوی موبایل"
            >
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="px-4 min-h-11 flex items-center rounded-xl text-[14px] font-semibold text-ink-soft hover:bg-primary-soft hover:text-primary">
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
