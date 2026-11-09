"use client";

import Link from "next/link";
import { ApiSettingsPanel } from "@/components/agents/ApiSettingsPanel";
import { isManager } from "@/lib/access";
import { useWorkspace } from "@/lib/workspace-context";

export default function AgentsSettingsPage() {
  const { me } = useWorkspace();
  if (me && !isManager(me)) return <div className="p-10 text-center text-sm text-muted">این بخش فقط برای مالک/مدیر است.</div>;
  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="text-[12px] text-muted mb-2"><Link href="/agents" className="text-primary">نمایندگی</Link> / تنظیمات</div>
      <h1 className="text-xl font-extrabold">تنظیمات نمایندگی</h1>
      <p className="text-[13.5px] text-muted mt-1 mb-4">کلید API و رمز امضای هر محصول، مستندات، آزمایش اتصال و لاگ رویدادهای ورودی</p>
      <ApiSettingsPanel />
    </div>
  );
}
