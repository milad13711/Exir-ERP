import type { ReactNode } from "react";
import { SettingsNav } from "@/components/layout/SettingsNav";
import { SettingsBreadcrumb } from "@/components/layout/SettingsBreadcrumb";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <div className="hidden md:block w-60 shrink-0 bg-slate-100 border-e border-border p-3.5 overflow-auto">
        <div className="text-xs font-bold text-muted px-2.5 pb-3.5">تنظیمات مرکزی ERP</div>
        <SettingsNav />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        <div className="h-14 border-b border-border flex items-center px-5 lg:px-8 shrink-0">
          <SettingsBreadcrumb />
        </div>
        <div className="p-5 lg:p-8 max-w-[1100px]">{children}</div>
      </div>
    </div>
  );
}
