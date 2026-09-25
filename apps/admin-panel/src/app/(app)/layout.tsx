import type { ReactNode } from "react";
import { AdminProvider } from "@/lib/admin-context";
import { AdminHeader } from "@/components/layout/AdminHeader";
import { AdminBottomNav } from "@/components/layout/AdminBottomNav";
import { PushPrompt } from "@/components/layout/PushPrompt";
import { SupportLiveNotifier } from "@/components/layout/SupportLiveNotifier";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <AdminHeader />
      <main className="flex-1 pb-24 lg:pb-8">{children}</main>
      <AdminBottomNav />
      <SupportLiveNotifier />
      <PushPrompt />
    </AdminProvider>
  );
}
