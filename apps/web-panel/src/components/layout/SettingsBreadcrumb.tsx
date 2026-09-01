"use client";

import { usePathname } from "next/navigation";
import { settingsNav } from "./settings-nav-items";

export function SettingsBreadcrumb() {
  const pathname = usePathname();
  const current = settingsNav.find((item) => item.href === pathname);

  return (
    <div className="text-[13px] text-muted">
      تنظیمات <span className="mx-1.5">/</span>{" "}
      <span className="text-ink font-bold">{current?.label ?? ""}</span>
    </div>
  );
}
