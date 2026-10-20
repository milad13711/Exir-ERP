"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { PlusIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { fetchCounters, type Counters } from "@/lib/correspondence-api";
import { BTN_PRIMARY, BTN_SOFT, fa } from "./corr-ui";

const TABS = [
  { href: "/correspondence", key: "inbox", label: "کارتابل" },
  { href: "/correspondence/incoming", key: "incoming", label: "وارده" },
  { href: "/correspondence/outgoing", key: "outgoing", label: "صادره" },
  { href: "/correspondence/internal", key: "internal", label: "داخلی" },
  { href: "/correspondence/archive", key: "archive", label: "بایگانی" },
  { href: "/correspondence/search", key: "search", label: "جست‌وجوی پیشرفته" },
  { href: "/correspondence/settings", key: "settings", label: "تنظیمات" },
] as const;

export type CorrTab = (typeof TABS)[number]["key"] | "none";

export function CorrShell({ active, title, children, actions }: { active: CorrTab; title?: string; children: ReactNode; actions?: ReactNode }) {
  const { me } = useWorkspace();
  const manager = me?.permissions?.manager ?? false;
  const [c, setC] = useState<Counters | null>(null);
  useEffect(() => {
    fetchCounters().then(setC).catch(() => {});
  }, [active]);
  const inboxBadge = c ? c.pendingSignature + c.pendingReview + c.referralsToMe : 0;
  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">{title ?? "مکاتبات سازمانی"}</h1>
            <ModuleHelp code="correspondence" />
          </div>
          <p className="text-[13px] text-muted mt-1">دبیرخانه: ثبت، شماره‌گذاری، امضا، ارجاع و بایگانی نامه‌ها</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actions}
          <Link href="/correspondence/register-incoming" className={BTN_SOFT}>ثبت وارده</Link>
          <Link href="/correspondence/new/outgoing" className={BTN_PRIMARY}>
            <PlusIcon className="w-4 h-4" />
            نامه‌ی جدید
          </Link>
        </div>
      </div>
      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="بخش‌های مکاتبات">
        {TABS.filter((t) => t.key !== "settings" || manager).map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={clsx("shrink-0 text-[12.5px] font-semibold px-3.5 py-2 min-h-[40px] inline-flex items-center rounded-[10px] border", active === t.key ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft")}
          >
            {t.label}
            {t.key === "inbox" && inboxBadge > 0 ? <span className="ms-1.5 bg-danger text-white rounded-full text-[10.5px] px-1.5">{fa(inboxBadge)}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="mt-4">{children}</div>
    </div>
  );
}
