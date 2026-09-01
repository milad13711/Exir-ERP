import type { ReactNode } from "react";
import { AdminProvider } from "@/lib/admin-context";
import { AdminHeader } from "@/components/layout/AdminHeader";
import { SupportLiveNotifier } from "@/components/layout/SupportLiveNotifier";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <AdminHeader />
      <main className="flex-1">{children}</main>
      <SupportLiveNotifier />
    </AdminProvider>
  );
}
