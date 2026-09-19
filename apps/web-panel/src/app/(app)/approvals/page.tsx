"use client";

import { useState } from "react";
import clsx from "clsx";
import { ApprovalsList } from "@/components/approvals/ApprovalsList";

const TABS = [
  { key: "PENDING", label: "در انتظار تأیید" },
  { key: "APPROVED", label: "تأییدشده" },
  { key: "REJECTED", label: "ردشده" },
] as const;

export default function ApprovalsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("PENDING");
  return (
    <div className="p-5 lg:p-7 max-w-[820px] mx-auto">
      <h1 className="text-xl font-extrabold mb-1">کارتابل تأیید</h1>
      <p className="text-[13.5px] text-muted mb-5">اسنادی که تأیید آن‌ها با شماست، از همه‌ی ماژول‌ها یک‌جا</p>
      <div className="flex items-center gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx("text-[12.5px] font-bold px-3.5 py-1.5 rounded-lg cursor-pointer", tab === t.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ApprovalsList status={tab} />
    </div>
  );
}
