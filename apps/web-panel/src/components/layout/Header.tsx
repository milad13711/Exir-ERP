"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CalendarIcon, ChatIcon, MenuIcon, ChevronDownIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { formatJalaliFull, toPersianDigits, getInitials } from "@/lib/persian";
import { clearToken } from "@/lib/api";
import { OfflineIndicator } from "./OfflineIndicator";
import { NotificationBell } from "./NotificationBell";

export function Header({
  onOpenSupport,
  onOpenMobileNav,
  supportUnread = false,
}: {
  onOpenSupport: () => void;
  onOpenMobileNav: () => void;
  supportUnread?: boolean;
}) {
  const [today] = useState(() => formatJalaliFull());
  const [menuOpen, setMenuOpen] = useState(false);
  const { me, subscription, license } = useWorkspace();
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <header className="h-17 bg-surface border-b border-border flex items-center justify-between px-4 lg:px-7 shrink-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="lg:hidden w-9 h-9 -ms-1 flex items-center justify-center rounded-lg text-ink-soft"
          aria-label="باز کردن منو"
        >
          <MenuIcon className="w-5 h-5" />
        </button>
        <div className="hidden lg:flex items-center gap-2 text-ink-soft text-[13.5px]">
          <CalendarIcon className="w-4 h-4" />
          {today}
        </div>
      </div>

      <div className="flex items-center gap-2 lg:gap-2.5">
        <OfflineIndicator />

        {license?.mode === "on_premise" && (license.state === "valid" || license.state === "grace") ? (
          <div
            className={clsx(
              "hidden sm:flex items-center gap-2.5 py-1.5 px-3.5 rounded-xl",
              license.state === "grace" ? "bg-warning-soft" : "bg-accent-soft",
            )}
          >
            <span className={clsx("text-[12.5px] font-bold", license.state === "grace" ? "text-warning" : "text-accent")}>
              استقرار اختصاصی
            </span>
            <span className="w-px h-3.5 bg-black/10" />
            <span className={clsx("text-[12.5px]", license.state === "grace" ? "text-warning" : "text-accent")}>
              {license.state === "grace"
                ? `لایسنس منقضی شده — ${toPersianDigits(license.daysLeft)} روز مهلت اضافه`
                : `${toPersianDigits(license.daysLeft)} روز تا انقضای لایسنس`}
            </span>
          </div>
        ) : subscription?.status === "TRIAL" ? (
          <Link
            href="/settings/billing"
            className="hidden sm:flex items-center gap-2.5 py-1.5 ps-3.5 pe-1.5 rounded-xl bg-warning-soft"
          >
            <span className="text-[12.5px] font-bold text-warning">استفاده رایگان</span>
            <span className="w-px h-3.5 bg-warning/20" />
            <span className="text-[12.5px] text-warning">
              {subscription.hoursLeft <= 48
                ? `${toPersianDigits(Math.max(0, subscription.hoursLeft))} ساعت تا پایان دوره‌ی رایگان`
                : `${toPersianDigits(subscription.daysLeft)} روز تا پایان دوره‌ی رایگان`}
            </span>
            <span className="border-0 bg-warning text-white text-xs font-bold py-1.5 px-3.5 rounded-[9px]">
              ارتقا و فعال‌سازی
            </span>
          </Link>
        ) : subscription ? (
          <Link
            href="/settings/billing"
            className="hidden sm:flex items-center gap-2.5 py-1.5 ps-3.5 pe-1.5 rounded-xl bg-primary-soft"
          >
            <span className="text-[12.5px] font-bold text-primary">{subscription.planName}</span>
            <span className="w-px h-3.5 bg-indigo-200" />
            <span className="text-[12.5px] text-primary">
              {toPersianDigits(subscription.daysLeft)} روز باقی‌مانده
            </span>
            <span className="border-0 bg-primary text-white text-xs font-bold py-1.5 px-3.5 rounded-[9px]">
              تمدید / ارتقا
            </span>
          </Link>
        ) : null}

        <button
          type="button"
          onClick={onOpenSupport}
          className="relative w-10 h-10 rounded-xl border border-border bg-white flex items-center justify-center text-accent"
          aria-label="پشتیبانی زنده"
        >
          <ChatIcon className="w-[19px] h-[19px]" />
          {supportUnread ? (
            <span className="absolute top-1.5 end-1.5 w-2.5 h-2.5 rounded-full bg-danger border-2 border-white" />
          ) : null}
        </button>

        <NotificationBell />

        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 ps-3 border-s border-border"
          >
            <div className="text-right">
              <div className="text-[13px] font-bold">{me?.user.name ?? me?.user.phone}</div>
              <div className="text-[11.5px] text-muted">{me?.user.roleTitle ?? ""}</div>
            </div>
            <div className="w-9.5 h-9.5 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-[13px]">
              {getInitials(me?.user.name)}
            </div>
            <ChevronDownIcon className="w-3.5 h-3.5 text-muted" />
          </button>

          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full mt-2 end-0 w-44 bg-surface border border-border rounded-xl shadow-lg py-1.5 z-20">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-start px-3.5 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                >
                  خروج از حساب کاربری
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
