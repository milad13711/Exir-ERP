"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { MobileBottomNav } from "./MobileBottomNav";
import { SupportChat } from "./SupportChat";
import { OnboardingGuide } from "./OnboardingGuide";
import { IncomingCallPopup } from "./IncomingCallPopup";
import { AiActionApprovalPopup } from "./AiActionApprovalPopup";
import { PushPrompt } from "./PushPrompt";
import { TwoFactorGraceBanner } from "./TwoFactorGraceBanner";
import { LicenseBlockedScreen } from "./LicenseBlockedScreen";
import { ChatIcon, LogoMark } from "@/components/icons";
import { usePathname } from "next/navigation";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";
import { canViewModule, canViewSettingsItem } from "@/lib/access";
import { primaryNav } from "./nav";

function AppShellInner({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(false);
  const { loading, license, me, installedModules } = useWorkspace();
  const pathname = usePathname();
  const navMatch = primaryNav.filter((i) => i.moduleCode && (pathname === i.href || pathname.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  const noAccess =
    !!me &&
    ((navMatch && !canViewModule(me, installedModules, navMatch.moduleCode)) ||
      (pathname.startsWith("/settings/") && !canViewSettingsItem(me, pathname.replace(/\/$/, "")) ));

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
    return <LicenseBlockedScreen reason={license.reason} />;
  }

  return (
    <div className="flex h-dvh bg-background overflow-hidden">
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

      <button
        type="button"
        onClick={() => setSupportOpen(true)}
        className="lg:hidden fixed bottom-24 end-4 w-13 h-13 rounded-full bg-gradient-to-br from-indigo-800 to-teal-600 shadow-xl flex items-center justify-center z-30"
        aria-label="پشتیبانی زنده"
      >
        <ChatIcon className="w-[22px] h-[22px] text-white" />
        {supportUnread ? (
          <span className="absolute top-1 end-1 w-2.5 h-2.5 rounded-full bg-danger border-2 border-white" />
        ) : null}
      </button>

      <SupportChat
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        onUnreadChange={setSupportUnread}
      />
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
