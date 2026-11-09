"use client";

import { useEffect, useMemo, useState } from "react";
import { safeHref } from "@/lib/safe-url";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ResellerApplicationModal } from "@/components/ResellerApplicationModal";
import {
  fetchResellerApplications,
  type ResellerApplication,
  type ResellerApplicationStatus,
} from "@/lib/api";

const PRODUCT_LABELS: Record<string, string> = {
  ERP: "اکسیر ERP",
  REAL_ESTATE: "اکسیراملاک",
  SMS_GATEWAY: "اکسیر اس‌ام‌اس",
  OTHER: "سایر",
};

const STATUS_LABEL: Record<ResellerApplicationStatus, string> = {
  PENDING: "در انتظار بررسی",
  APPROVED: "تأیید شده",
  REJECTED: "رد شده",
};

type Filter = ResellerApplicationStatus | "همه";

export default function ResellerApplicationsPage() {
  const [apps, setApps] = useState<ResellerApplication[] | null>(null);
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [openId, setOpenId] = useState<string | null>(null);

  function reload() {
    fetchResellerApplications().then(setApps).catch(() => setApps([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!apps) return [];
    return filter === "همه" ? apps : apps.filter((a) => a.status === filter);
  }, [apps, filter]);

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader title="درخواست‌های همکاری در فروش" subtitle="درخواست‌های نمایندگی از فرم «همکاری با ما» در eta.co.ir" />
      <div className="mt-4 text-[12.5px] bg-amber-50 text-amber-800 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed">
        بررسی و تأیید درخواست‌ها به ماژول «نمایندگی» در پنل اکسیر (تننت اصلی ← نمایندگی ← درخواست‌ها) منتقل شده است تا محصول و سطح نماینده همان‌جا انتخاب شود. این صفحه فقط برای مشاهده است.
      </div>

      <div className="flex items-center gap-2 mt-5 mb-4">
        {(["PENDING", "APPROVED", "REJECTED", "همه"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              "text-[12px] font-bold px-3.5 py-1.5 rounded-[10px] cursor-pointer",
              filter === f ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {f === "همه" ? "همه" : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {apps === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">درخواستی در این وضعیت نیست</div>
        ) : (
          filtered.map((app, i) => (
            <div key={app.id} onClick={() => setOpenId(app.id)} className={clsx("px-4 py-3.5 cursor-pointer hover:bg-slate-50", i < filtered.length - 1 && "border-b border-border")}>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[13px] font-bold">{app.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {[app.company, app.phone, app.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {app.productCode ? <Badge tone="primary">{PRODUCT_LABELS[app.productCode] ?? app.productCode}</Badge> : null}
                <Badge tone={app.status === "APPROVED" ? "success" : app.status === "REJECTED" ? "danger" : "warning"}>
                  {STATUS_LABEL[app.status]}
                </Badge>

              </div>

              {app.message ? <div className="text-[12px] text-ink-soft mt-2 leading-relaxed">{app.message}</div> : null}
              {app.websiteUrl ? (
                <a href={safeHref(app.websiteUrl)} target="_blank" rel="noreferrer" className="text-[11.5px] text-primary mt-1 inline-block" dir="ltr">
                  {app.websiteUrl}
                </a>
              ) : null}
              {app.status === "REJECTED" && app.rejectionNote ? (
                <div className="text-[11.5px] text-danger mt-1.5">دلیل رد: {app.rejectionNote}</div>
              ) : null}

            </div>
          ))
        )}
      </Card>
      {openId ? <ResellerApplicationModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}
