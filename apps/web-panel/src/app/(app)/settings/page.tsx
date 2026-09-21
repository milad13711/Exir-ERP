"use client";

import Link from "next/link";
import { settingsNav } from "@/components/layout/settings-nav-items";
import { canViewSettingsItem } from "@/lib/access";
import { useWorkspace } from "@/lib/workspace-context";
import { ChevronDownIcon } from "@/components/icons";

/**
 * روی موبایل (< md) سایدبار تنظیمات پنهان است — این صفحه همان لیست را
 * به‌عنوان یک منوی قابل لمس نشان می‌دهد تا بخش‌هایی مثل «پروفایل من» از
 * روی گوشی هم قابل دسترسی باشند، نه فقط از سایدبار دسکتاپ.
 */
export default function SettingsIndexPage() {
  const { installedModules, me } = useWorkspace();
  const visibleNav = settingsNav.filter((item) => (!item.moduleCode || installedModules.has(item.moduleCode)) && canViewSettingsItem(me, item.href));

  return (
    <div className="max-w-[560px]">
      <h1 className="text-xl font-extrabold mb-1">تنظیمات</h1>
      <p className="text-[13px] text-muted mb-5">مدیریت پروفایل، کاربران، اشتراک و سایر تنظیمات محیط کاری</p>

      <div className="flex flex-col rounded-2xl border border-border overflow-hidden bg-surface">
        {visibleNav.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 ${i < visibleNav.length - 1 ? "border-b border-border" : ""}`}
          >
            <item.icon className="w-[18px] h-[18px] text-ink-soft shrink-0" />
            <span className="flex-1 text-[13.5px] font-semibold">{item.label}</span>
            <ChevronDownIcon className="w-3.5 h-3.5 text-muted -rotate-90 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
