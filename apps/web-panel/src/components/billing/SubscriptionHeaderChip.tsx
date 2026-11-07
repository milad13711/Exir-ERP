"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError, requestRenewalInvoice } from "@/lib/api";
import { bannerCopy, tenantDetail } from "@/lib/subscription-copy";

const TONE = {
  warning: { box: "bg-warning-soft", text: "text-warning", divider: "bg-warning/20", btn: "bg-warning" },
  danger: { box: "bg-danger-soft", text: "text-danger", divider: "bg-danger/20", btn: "bg-danger" },
  primary: { box: "bg-primary-soft", text: "text-primary", divider: "bg-indigo-200", btn: "bg-primary" },
  accent: { box: "bg-accent-soft", text: "text-accent", divider: "bg-black/10", btn: "bg-accent" },
} as const;

/**
 * تنها نمایش وضعیت اشتراک/لایسنس/تمدید ماژول در هدر. همه‌چیز از خلاصه‌ی واحد بک‌اند می‌آید
 * (useWorkspace().subscription) — هیچ محاسبه‌ی تاریخ/انقضای مستقل اینجا نیست.
 */
export function SubscriptionHeaderChip({ onOpenSupport }: { onOpenSupport: () => void }) {
  const { subscription: s, refreshSubscription } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!s) return null;
  const admin = s.viewer === "ADMIN";

  async function request(moduleCode: string | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await requestRenewalInvoice(moduleCode ?? undefined);
      refreshSubscription();
      router.push(r.status === "PENDING" ? `/pay/${r.invoiceId}` : "/settings/billing");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "درخواست ثبت نشد");
    } finally {
      setBusy(false);
    }
  }

  if (s.banner) {
    const c = bannerCopy(s.banner, s.tenant, admin);
    const t = TONE[c.tone];
    const btnCls = clsx("border-0 text-white text-xs font-bold py-1.5 px-3.5 rounded-[9px] disabled:opacity-60", t.btn);
    return (
      <>
        <div className={clsx("hidden sm:flex items-center gap-2.5 py-1.5 rounded-xl", t.box, c.cta ? "ps-3.5 pe-1.5" : "px-3.5")} title={error ?? undefined}>
          <Link href={admin ? "/settings/billing" : "#"} className={clsx("flex items-center gap-2.5", !admin && "pointer-events-none")}>
            <span className={clsx("text-[12.5px] font-bold", t.text)}>{c.label}</span>
            <span className={clsx("w-px h-3.5", t.divider)} />
            <span className={clsx("text-[12.5px]", t.text)}>{error ?? c.detail}</span>
          </Link>
          {c.cta?.kind === "pay" ? (
            <Link href={c.cta.href} className={btnCls}>{c.cta.label}</Link>
          ) : c.cta?.kind === "request" ? (
            <button type="button" disabled={busy} onClick={() => request(c.cta && c.cta.kind === "request" ? c.cta.moduleCode : null)} className={btnCls}>
              {busy ? "..." : c.cta.label}
            </button>
          ) : c.cta?.kind === "support" ? (
            <button type="button" onClick={onOpenSupport} className={btnCls}>{c.cta.label}</button>
          ) : null}
        </div>
        {/* موبایل: فقط نشانگر فشرده که به صفحه‌ی اشتراک می‌رود */}
        {admin ? (
          <Link href="/settings/billing" className={clsx("sm:hidden flex items-center py-1.5 px-2.5 rounded-xl text-[11.5px] font-bold", t.box, t.text)}>
            {s.banner.state === "TRIAL" ? "آزمایشی" : s.banner.state === "EXPIRING_SOON" ? "تمدید" : s.banner.state === "SUSPENDED" ? "تعلیق" : "اشتراک"}
          </Link>
        ) : null}
      </>
    );
  }

  // بدون هشدار: فقط مدیر یک نشان آرام می‌بیند؛ کاربر عادی هیچ‌چیز (وضعیت خنثی)
  if (!admin) return null;
  const t = TONE[s.tenant.source === "ON_PREMISE_LICENSE" ? "accent" : "primary"];
  const label = s.tenant.source === "ON_PREMISE_LICENSE" ? "استقرار اختصاصی" : (s.tenant.planName ?? "اشتراک");
  return (
    <Link href="/settings/billing" className={clsx("hidden sm:flex items-center gap-2.5 py-1.5 px-3.5 rounded-xl", t.box)}>
      <span className={clsx("text-[12.5px] font-bold", t.text)}>{label}</span>
      <span className={clsx("w-px h-3.5", t.divider)} />
      <span className={clsx("text-[12.5px]", t.text)}>{tenantDetail(s.tenant)}</span>
    </Link>
  );
}
