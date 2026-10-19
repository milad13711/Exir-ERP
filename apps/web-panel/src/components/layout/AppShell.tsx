"use client";

import Link from "next/link";
import { useMessengerUnread } from "@/lib/useMessengerUnread";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { MobileBottomNav } from "./MobileBottomNav";
import { SupportChat } from "./SupportChat";
import { OnboardingGuide } from "./OnboardingGuide";
import { IncomingCallPopup } from "./IncomingCallPopup";
import { AiActionApprovalPopup } from "./AiActionApprovalPopup";
import { PushPrompt } from "./PushPrompt";
import { MessengerRuntime } from "@/components/messenger/MessengerRuntime";
import { TwoFactorGraceBanner } from "./TwoFactorGraceBanner";
import { LicenseBlockedScreen } from "./LicenseBlockedScreen";
import { ChatIcon, LogoMark } from "@/components/icons";
import { usePathname } from "next/navigation";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";
import { canViewModule, canViewSettingsItem } from "@/lib/access";
import { primaryNav } from "./nav";
import { subscribeSupportOpen } from "@/lib/support-open";

function AppShellInner({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(false);
  const [supportFocusTicket, setSupportFocusTicket] = useState<string | null>(null);
  useEffect(
    () =>
      subscribeSupportOpen((r) => {
        setSupportFocusTicket(r.ticketId);
        setSupportOpen(true);
      }),
    [],
  );
  const { loading, license, me, installedModules } = useWorkspace();
  const messengerUnread = useMessengerUnread(installedModules.has("messenger"));
  const pathname = usePathname();
  const navMatch = primaryNav.filter((i) => i.moduleCode && (pathname === i.href || pathname.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  const noAccess =
    !!me &&
    ((navMatch && !canViewModule(me, installedModules, navMatch.moduleCode)) ||
      (pathname.startsWith("/settings/") && !canViewSettingsItem(me, pathname.replace(/\/$/, "")) ));

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      const root = document.documentElement;
      if (!mq.matches) return root.style.removeProperty("--app-h");
      root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      if (vv.offsetTop > 0) window.scrollTo(0, 0); // iOS شیفت صفحه هنگام باز شدن کیبورد
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-gradient-to-br from-[#0b1f4d] via-[#0b2d5b] to-[#132a54]">
        <LogoMark className="w-16 h-16" />
        <div className="text-white text-lg font-extrabold">
          exir <span className="text-white/70 font-bold">ERP</span>
        </div>
        <div className="w-6 h-6 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
      </div>
    );
  }

  // The backend itself blocks every route except /license/status once an
  // on-premise license is invalid/expired past its grace period — this
  // mirrors that so the app shows a clear reason instead of blank pages
  // full of failed requests.
  if (license?.mode === "on_premise" && (license.state === "invalid" || license.state === "expired")) {
    return <LicenseBlockedScreen reason={license.reason} installationId={license.installationId} />;
  }

  return (
    <div className="flex h-[var(--app-h,100dvh)] lg:h-dvh bg-background overflow-hidden">
      <Sidebar />
      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onOpenSupport={() => setSupportOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          supportUnread={supportUnread}
        />
        <TwoFactorGraceBanner />
        <main className="flex-1 overflow-auto">
          {noAccess ? (
            <div className="p-10 text-center">
              <div className="text-lg font-extrabold mb-2">به این بخش دسترسی ندارید</div>
              <p className="text-[13.5px] text-muted">برای دریافت دسترسی با مدیر مجموعه تماس بگیرید.</p>
            </div>
          ) : (
            children
          )}
        </main>
        <MobileBottomNav />
      </div>
      <PushPrompt />

      {installedModules.has("messenger") && canViewModule(me, installedModules, "messenger") && !pathname.startsWith("/messenger") ? (
        <Link
          href="/messenger"
          className="lg:hidden fixed bottom-24 end-4 w-13 h-13 rounded-full bg-gradient-to-br from-indigo-800 to-teal-600 shadow-xl flex items-center justify-center z-30"
          aria-label="پیام‌رسان داخلی"
        >
          <ChatIcon className="w-[22px] h-[22px] text-white" />
          {messengerUnread > 0 ? (
            <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
              {messengerUnread > 99 ? "99+" : messengerUnread}
            </span>
          ) : null}
        </Link>
      ) : null}

      <SupportChat
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        onUnreadChange={setSupportUnread}
        focusTicketId={supportFocusTicket}
      />
      {installedModules.has("messenger") ? <MessengerRuntime /> : null}
      <IncomingCallPopup />
      <AiActionApprovalPopup />
      <OnboardingGuide />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShellInner>{children}</AppShellInner>
    </WorkspaceProvider>
  );
}
