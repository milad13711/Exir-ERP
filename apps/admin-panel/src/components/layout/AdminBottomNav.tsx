"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { MenuIcon, CloseIcon } from "@/components/icons";
import { NAV_ITEMS, PRIMARY_NAV_HREFS } from "./nav-items";

/** نوار پایین موبایل: چهار بخش اصلی + «بیشتر» برای بقیه. روی دسکتاپ نمایش داده نمی‌شود. */
export function AdminBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV_ITEMS.filter((i) => PRIMARY_NAV_HREFS.includes(i.href));
  const rest = NAV_ITEMS.filter((i) => !PRIMARY_NAV_HREFS.includes(i.href));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const moreActive = rest.some((i) => isActive(i.href));

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/92 backdrop-blur-md border-t border-border pb-safe">
        <div className="grid grid-cols-5 h-16">
          {primary.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={clsx("flex flex-col items-center justify-center gap-1", active ? "text-primary" : "text-muted")}>
                <span className={clsx("w-11 h-7 rounded-full flex items-center justify-center transition-colors", active && "bg-primary-soft")}>
                  <Icon className="w-5 h-5" />
                </span>
                <span className="text-[10.5px] font-bold">{item.label}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className={clsx("flex flex-col items-center justify-center gap-1 cursor-pointer", moreActive ? "text-primary" : "text-muted")}>
            <span className={clsx("w-11 h-7 rounded-full flex items-center justify-center", moreActive && "bg-primary-soft")}>
              <MenuIcon className="w-5 h-5" />
            </span>
            <span className="text-[10.5px] font-bold">بیشتر</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink/45 backdrop-blur-[2px] flex items-end animate-fade" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div className="w-full bg-surface rounded-t-3xl p-4 pb-safe animate-sheet">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-extrabold">همه‌ی بخش‌ها</div>
              <button type="button" onClick={() => setMoreOpen(false)} className="w-9 h-9 rounded-xl flex items-center justify-center text-muted hover:bg-slate-100 cursor-pointer" aria-label="بستن">
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5 pb-3">
              {rest.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={clsx(
                      "flex flex-col items-center gap-2 rounded-2xl border py-4 px-2 text-center",
                      isActive(item.href) ? "border-primary/30 bg-primary-soft text-primary" : "border-border text-ink-soft",
                    )}
                  >
                    <Icon className="w-6 h-6" />
                    <span className="text-[11.5px] font-bold leading-4">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
