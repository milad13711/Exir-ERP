import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-[15px] font-extrabold text-primary">
          اکسیر ERP
        </Link>
        <nav className="flex items-center gap-5 text-[13px] font-semibold text-ink-soft">
          <Link href="/industries" className="hover:text-primary transition-colors">
            صنف‌ها
          </Link>
          <Link href="/modules" className="hover:text-primary transition-colors">
            ماژول‌ها
          </Link>
          <Link
            href="/configure"
            className="bg-primary text-white px-4 py-2 rounded-xl hover:bg-primary/90 transition-colors"
          >
            شروع رایگان
          </Link>
        </nav>
      </div>
    </header>
  );
}
