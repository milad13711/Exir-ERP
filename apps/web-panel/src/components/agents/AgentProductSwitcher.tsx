"use client";

import { useEffect, useState } from "react";
import { agentsMe, type AgentMembership } from "@/lib/api";
import { useActiveMembershipId } from "@/lib/agent-active";

/** تعویض‌کننده‌ی محصول در هدر حساب نماینده (فقط راحتی نمایشی؛ دسترسی واقعی سمت سرور و به‌ازای عضویت‌های خودش است). */
export function AgentProductSwitcher() {
  const [ms, setMs] = useState<AgentMembership[]>([]);
  const [active, setActive] = useActiveMembershipId();
  useEffect(() => { agentsMe().then((r) => setMs(r.memberships)).catch(() => setMs([])); }, []);
  if (ms.length < 2) return null;
  return (
    <select
      aria-label="تعویض محصول"
      value={active ?? ms[0]!.id}
      onChange={(e) => setActive(e.target.value)}
      className="text-[12.5px] font-bold bg-primary-soft text-primary rounded-xl px-3 min-h-[40px] max-w-[150px] sm:max-w-[220px] outline-none"
    >
      {ms.map((m) => <option key={m.id} value={m.id}>{m.product.name}</option>)}
    </select>
  );
}
