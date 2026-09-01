"use client";

import Link from "next/link";
import { LogoMark } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { useAdmin } from "@/lib/admin-context";

export function AdminHeader() {
  const { admin, logout } = useAdmin();

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-5 lg:px-7 shrink-0">
      <div className="flex items-center gap-6">
        <Link href="/tenants" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white">
            <LogoMark className="w-4 h-4" />
          </div>
          <span className="text-[14px] font-extrabold">پنل مدیریت اکسیر</span>
          <Badge tone="warning">داخلی</Badge>
        </Link>
        <nav className="hidden sm:flex items-center gap-1">
          <Link
            href="/tenants"
            className="text-[13px] font-semibold text-ink-soft px-3 py-2 rounded-lg hover:bg-slate-100"
          >
            تننت‌ها
          </Link>
          <Link
            href="/catalog"
            className="text-[13px] font-semibold text-ink-soft px-3 py-2 rounded-lg hover:bg-slate-100"
          >
            کاتالوگ
          </Link>
          <Link
            href="/support"
            className="text-[13px] font-semibold text-ink-soft px-3 py-2 rounded-lg hover:bg-slate-100"
          >
            پشتیبانی
          </Link>
          <Link
            href="/tasks"
            className="text-[13px] font-semibold text-ink-soft px-3 py-2 rounded-lg hover:bg-slate-100"
          >
            وظایف
          </Link>
          <Link
            href="/leads"
            className="text-[13px] font-semibold text-ink-soft px-3 py-2 rounded-lg hover:bg-slate-100"
          >
            فروش
          </Link>
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
    </header>
  );
}
