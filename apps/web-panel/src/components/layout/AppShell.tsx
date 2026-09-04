"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { MobileBottomNav } from "./MobileBottomNav";
import { SupportChat } from "./SupportChat";
import { IncomingCallPopup } from "./IncomingCallPopup";
import { AiActionApprovalPopup } from "./AiActionApprovalPopup";
import { LicenseBlockedScreen } from "./LicenseBlockedScreen";
import { ChatIcon } from "@/components/icons";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";

function AppShellInner({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(false);
  const { loading, license } = useWorkspace();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
        <main className="flex-1 overflow-auto">{children}</main>
        <MobileBottomNav />
      </div>

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
