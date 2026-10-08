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
  approveResellerApplication,
  rejectResellerApplication,
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");

  function reload() {
    fetchResellerApplications().then(setApps).catch(() => setApps([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!apps) return [];
    return filter === "همه" ? apps : apps.filter((a) => a.status === filter);
  }, [apps, filter]);

  async function handleApprove(id: string) {
    setBusyId(id);
    try {
      await approveResellerApplication(id);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setBusyId(id);
    try {
      await rejectResellerApplication(id, rejectionNote.trim() || undefined);
      setRejectingId(null);
      setRejectionNote("");
      reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader title="درخواست‌های همکاری در فروش" subtitle="درخواست‌های نمایندگی از فرم «همکاری با ما» در eta.co.ir" />

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
                {app.status === "PENDING" ? (
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleApprove(app.id)}
                      disabled={busyId === app.id}
                      className="text-[12px] font-bold text-success bg-success-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      تأیید
                    </button>
                    <button
                      onClick={() => setRejectingId(rejectingId === app.id ? null : app.id)}
                      disabled={busyId === app.id}
                      className="text-[12px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      رد
                    </button>
                  </div>
                ) : null}
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

              {rejectingId === app.id ? (
                <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    value={rejectionNote}
                    onChange={(e) => setRejectionNote(e.target.value)}
                    placeholder="دلیل رد (اختیاری)..."
                    className="flex-1 text-[12px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2"
                  />
                  <button
                    onClick={() => handleReject(app.id)}
                    disabled={busyId === app.id}
                    className="text-[12px] font-bold text-white bg-danger px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    ثبت رد
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>
      {openId ? <ResellerApplicationModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}
