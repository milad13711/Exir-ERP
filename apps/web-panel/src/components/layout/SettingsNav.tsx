"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { settingsNav } from "./settings-nav-items";
import { canViewSettingsItem } from "@/lib/access";
import { useWorkspace } from "@/lib/workspace-context";

export function SettingsNav() {
  const pathname = usePathname();
  const { installedModules, me } = useWorkspace();
  const visibleNav = settingsNav.filter((item) => (!item.moduleCode || installedModules.has(item.moduleCode)) && canViewSettingsItem(me, item.href));

  return (
    <nav className="flex flex-col gap-1">
      {visibleNav.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13.5px] font-semibold",
              active ? "bg-ink text-white" : "text-ink-soft",
            )}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
