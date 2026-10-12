"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { mobileNav } from "./nav";
import { useWorkspace } from "@/lib/workspace-context";
import { canViewModule } from "@/lib/access";
import { useMessengerUnread } from "@/lib/useMessengerUnread";

export function MobileBottomNav() {
  const pathname = usePathname();
  const { me, installedModules } = useWorkspace();
  const messengerUnread = useMessengerUnread(installedModules.has("messenger"));
  const items = mobileNav.filter((item) => canViewModule(me, installedModules, item.moduleCode));

  return (
    <nav className="lg:hidden shrink-0 bg-surface border-t border-border flex pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
      {items.map((item) => {
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
            <span className="relative">
              <item.icon className="w-[21px] h-[21px]" />
              {item.href === "/messenger" && messengerUnread > 0 && (
                <span className="absolute -top-1.5 -end-2 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center">
                  {messengerUnread > 99 ? "99+" : messengerUnread}
                </span>
              )}
            </span>
            <span className={clsx("text-[10px]", active ? "font-bold" : "font-semibold")}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
