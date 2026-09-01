"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogoMark, MenuIcon, CloseIcon } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { useAdmin } from "@/lib/admin-context";

const NAV_ITEMS = [
  { href: "/tenants", label: "تننت‌ها" },
  { href: "/catalog", label: "کاتالوگ" },
  { href: "/support", label: "پشتیبانی" },
  { href: "/tasks", label: "وظایف" },
  { href: "/leads", label: "فروش" },
];

export function AdminHeader() {
  const { admin, logout } = useAdmin();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="bg-surface border-b border-border shrink-0">
      <div className="h-16 flex items-center justify-between px-4 sm:px-5 lg:px-7">
        <div className="flex items-center gap-6">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="sm:hidden w-9 h-9 -ms-1 rounded-lg flex items-center justify-center text-ink-soft hover:bg-slate-100 shrink-0"
            aria-label="باز کردن منو"
          >
            {mobileOpen ? <CloseIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
          </button>
          <Link href="/tenants" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white shrink-0">
              <LogoMark className="w-4 h-4" />
            </div>
            <span className="text-[13px] sm:text-[14px] font-extrabold truncate">پنل مدیریت اکسیر</span>
            <span className="hidden sm:inline-block">
              <Badge tone="warning">داخلی</Badge>
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[13px] font-semibold text-ink-soft px-3 py-2 rounded-lg hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {admin ? (
            <div className="text-left hidden sm:block">
              <div className="text-[12.5px] font-bold">{admin.name}</div>
              <div className="text-[11px] text-muted">{admin.team}</div>
            </div>
          ) : null}
          <button
            onClick={logout}
            className="text-[12.5px] font-bold text-danger px-3 py-2 rounded-lg hover:bg-danger-soft cursor-pointer"
          >
            خروج
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <nav className="sm:hidden border-t border-border px-3 py-2 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                "text-[13.5px] font-semibold px-3.5 py-2.5 rounded-lg",
                pathname.startsWith(item.href) ? "bg-primary-soft text-primary" : "text-ink-soft hover:bg-slate-50",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
