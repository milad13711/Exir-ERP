"use client";

import { useEffect, useState } from "react";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { AgentAdmin } from "@/components/agents/AgentAdmin";
import { AgentPortal } from "@/components/agents/AgentPortal";
import { TabBar } from "@/components/agents/agent-ui";
import { agentsMeExists } from "@/lib/api";
import { isManager } from "@/lib/access";
import { useWorkspace } from "@/lib/workspace-context";

type View = "admin" | "portal";

export default function AgentsPage() {
  const { me } = useWorkspace();
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [view, setView] = useState<View | null>(null);
  const m = me?.permissions?.modules["agents"];
  const manager = isManager(me);
  const adminAccess = manager || !!m?.canViewAll;

  useEffect(() => { agentsMeExists().then((r) => setIsAgent(r.agent)).catch(() => setIsAgent(false)); }, []);
  useEffect(() => {
    if (isAgent === null) return;
    setView((v) => v ?? (adminAccess ? "admin" : isAgent ? "portal" : null));
  }, [isAgent, adminAccess]);

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-1.5"><h1 className="text-xl font-extrabold">نمایندگی</h1><ModuleHelp code="agents" /></div>
      <p className="text-[13.5px] text-muted mt-1">پروفایل نماینده، عضویت در محصولات اکسیر، مشتریان، تفاهم‌نامه و API ورودی رویدادها</p>
      <div className="mt-4 mb-4">
        {adminAccess && isAgent ? <TabBar value={view ?? "admin"} onChange={setView} tabs={[{ id: "admin", label: "مدیریت" }, { id: "portal", label: "پنل من" }]} /> : null}
      </div>
      {view === "admin" && adminAccess ? <AgentAdmin canCreate={manager || !!m?.canCreate} canEdit={manager || !!m?.canEdit} canDelete={manager || !!m?.canDelete} /> : null}
      {view === "portal" && isAgent ? <AgentPortal /> : null}
      {isAgent === false && !adminAccess ? <div className="py-10 text-center text-sm text-muted">شما نماینده‌ی ثبت‌شده‌ای نیستید.</div> : null}
    </div>
  );
}
