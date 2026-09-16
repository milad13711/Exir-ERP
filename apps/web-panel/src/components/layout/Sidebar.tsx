"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogoMark, DocsIcon } from "@/components/icons";
import { primaryNav, secondaryNav, type NavItem } from "./nav";
import { useWorkspace } from "@/lib/workspace-context";

function NavLink({
  href,
  label,
  Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  Icon: (typeof primaryNav)[number]["icon"];
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={clsx(
        "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors",
        active
          ? "bg-primary-soft text-primary font-bold"
          : "text-ink-soft font-medium hover:bg-slate-50",
      )}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      {label}
    </Link>
  );
}

function useVisibleNav(items: NavItem[]) {
  const { installedModules } = useWorkspace();
  return items.filter((item) => !item.moduleCode || installedModules.has(item.moduleCode));
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const visiblePrimaryNav = useVisibleNav(primaryNav);

  return (
    <div className="flex flex-col h-full p-3.5">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <div className="w-8.5 h-8.5 rounded-[10px] bg-primary flex items-center justify-center">
          <LogoMark className="w-[18px] h-[18px] text-white" />
        </div>
        <span className="text-[17px] font-extrabold">اکسیر ERP</span>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto">
        {visiblePrimaryNav.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            Icon={item.icon}
            active={pathname === item.href}
            onNavigate={onNavigate}
          />
        ))}
        <div className="h-px bg-border my-3 mx-1.5" />
        {secondaryNav.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            Icon={item.icon}
            active={pathname.startsWith(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="shrink-0 mt-3 p-3.5 rounded-2xl bg-accent-soft border border-teal-100">
        <div className="text-[12.5px] text-teal-800 font-semibold leading-relaxed flex items-center gap-1.5">
          <DocsIcon className="w-4 h-4 shrink-0" />
          به مستندات API، وب‌هوک و MCP نیاز دارید؟
        </div>
        <Link href="/settings/api" className="text-[12.5px] font-bold text-teal-800 mt-1 inline-block">
          مشاهده مستندات ←
        </Link>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-[232px] shrink-0 bg-surface border-e border-border">
      <SidebarContent />
    </aside>
  );
}
