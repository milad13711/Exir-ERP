"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { mobileNav } from "./nav";

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden shrink-0 bg-surface border-t border-border flex pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
      {mobileNav.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex-1 flex flex-col items-center gap-1",
              active ? "text-primary" : "text-muted",
            )}
          >
            <item.icon className="w-[21px] h-[21px]" />
            <span className={clsx("text-[10px]", active ? "font-bold" : "font-semibold")}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
