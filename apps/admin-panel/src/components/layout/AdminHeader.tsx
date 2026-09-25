"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogoMark } from "@/components/icons";
import { useAdmin } from "@/lib/admin-context";
import { getInitials } from "@/lib/persian";
import { PushNotificationsButton } from "./PushNotificationsButton";
import { NAV_ITEMS } from "./nav-items";

export function AdminHeader() {
  const { admin, logout } = useAdmin();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-border shrink-0 pt-[env(safe-area-inset-top)]">
      <div className="h-15 flex items-center justify-between gap-3 px-3.5 sm:px-5 lg:px-7">
        <div className="flex items-center gap-5 min-w-0">
          <Link href="/tenants" className="flex items-center gap-2.5 shrink-0">
            <LogoMark className="w-9 h-auto" />
            <div className="leading-tight">
              <div className="text-[14px] font-extrabold tracking-tight">اکسیر ERP</div>
              <div className="text-[10.5px] text-muted font-semibold">پنل مدیریت</div>
            </div>
          </Link>
          <nav className="hidden lg:flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "text-[12.5px] font-bold px-3 py-2 rounded-xl transition-colors",
                    active ? "bg-primary-soft text-primary" : "text-ink-soft hover:bg-slate-100",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <PushNotificationsButton />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full ps-1 pe-1 sm:pe-3 py-1 hover:bg-slate-100 cursor-pointer"
              aria-label="منوی حساب"
            >
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent text-white text-[12px] font-bold flex items-center justify-center">
                {getInitials(admin?.name)}
              </span>
              <span className="hidden sm:block text-right leading-tight">
                <span className="block text-[12.5px] font-bold">{admin?.name}</span>
                <span className="block text-[10.5px] text-muted">{admin?.team}</span>
              </span>
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute top-full mt-2 end-0 w-56 bg-surface border border-border rounded-2xl shadow-xl py-1.5 z-20 animate-fade">
                  <div className="px-3.5 py-2.5 border-b border-border mb-1">
                    <div className="text-[13px] font-bold">{admin?.name}</div>
                    <div className="text-[11px] text-muted">{admin?.team}</div>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full text-start px-3.5 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger-soft cursor-pointer"
                  >
                    خروج از حساب
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
