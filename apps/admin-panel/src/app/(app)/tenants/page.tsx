"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BuildingIcon, UsersIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchTenants, reactivateTenant, ApiError, type AdminTenant } from "@/lib/api";
import { NewTenantModal } from "@/components/tenants/NewTenantModal";
import { SuspendTenantModal } from "@/components/tenants/SuspendTenantModal";

const STATUS_LABELS: Record<AdminTenant["status"], string> = {
  PENDING_PROVISION: "در حال راه‌اندازی",
  PENDING_PAYMENT: "در انتظار پرداخت فاکتور",
  ACTIVE: "فعال",
  SUSPENDED: "معلق",
  CANCELLED: "لغوشده",
};

const STATUS_TONES: Record<AdminTenant["status"], "success" | "warning" | "danger" | "neutral"> = {
  PENDING_PROVISION: "warning",
  PENDING_PAYMENT: "warning",
  ACTIVE: "success",
  SUSPENDED: "danger",
  CANCELLED: "neutral",
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<AdminTenant[] | null>(null);
  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<AdminTenant | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    fetchTenants().then(setTenants).catch(() => setTenants([]));
  }
  useEffect(reload, []);

  async function handleReactivate(tenant: AdminTenant) {
    setActionError(null);
    try {
      const updated = await reactivateTenant(tenant.id);
      setTenants((prev) => prev?.map((t) => (t.id === tenant.id ? { ...t, ...updated } : t)) ?? prev);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "فعال‌سازی مجدد ناموفق بود");
    }
  }

  const [query, setQuery] = useState("");
  const activeCount = tenants?.filter((t) => t.status === "ACTIVE").length ?? 0;
  const pendingCount = tenants?.filter((t) => t.status === "PENDING_PAYMENT" || t.status === "PENDING_PROVISION").length ?? 0;
  const suspendedCount = tenants?.filter((t) => t.status === "SUSPENDED").length ?? 0;
  const visible = (tenants ?? []).filter((t) => {
    const q = query.trim().toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
  });

  return (
    <div className="p-4 sm:p-4 sm:p-5 lg:p-7 max-w-[1100px] mx-auto">
      <PageHeader
        title="تننت‌ها"
        subtitle={tenants ? `${toPersianDigits(tenants.length)} کسب‌وکار ثبت‌شده` : "..."}
        action={
          <button
            onClick={() => setNewTenantOpen(true)}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark transition-colors text-white text-[13px] font-bold px-4 py-2.5 rounded-xl cursor-pointer shadow-[0_6px_16px_-8px_rgba(26,69,200,0.7)]"
          >
            <PlusIcon className="w-4 h-4" />
            تننت جدید
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mt-5">
        {[
          { label: "فعال", value: activeCount, tone: "text-success bg-success-soft" },
          { label: "در انتظار", value: pendingCount, tone: "text-warning bg-warning-soft" },
          { label: "معلق", value: suspendedCount, tone: "text-danger bg-danger-soft" },
        ].map((k) => (
          <Card key={k.label} className="p-3 sm:p-4 flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-ink-soft">{k.label}</span>
            <span className={`min-w-8 h-8 px-2 rounded-lg flex items-center justify-center text-[14px] font-extrabold ${k.tone}`}>
              {tenants ? toPersianDigits(k.value) : "—"}
            </span>
          </Card>
        ))}
      </div>

      <div className="relative mt-4">
        <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 start-3.5" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جست‌وجوی نام یا شناسه‌ی تننت..."
          className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl ps-10 pe-4 py-3 focus:border-primary transition-colors"
        />
      </div>

      {actionError && (
        <div className="mt-4 text-[12.5px] text-danger font-semibold bg-danger-soft rounded-xl px-3.5 py-2.5">{actionError}</div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {tenants === null ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-slate-200/60 animate-pulse" />)
        ) : visible.length === 0 ? (
          <Card className="p-10 text-center text-muted text-sm">{tenants.length === 0 ? "هنوز تننتی ثبت نشده است" : "موردی پیدا نشد"}</Card>
        ) : (
          visible.map((t) => (
            <Card key={t.id} className="p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-start gap-3.5">
                <Link href={`/tenants/${t.id}`} className="w-11 h-11 rounded-2xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                  <BuildingIcon className="w-5 h-5" />
                </Link>
                <Link href={`/tenants/${t.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-extrabold hover:text-primary truncate">{t.name}</span>
                    <Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                    {t.deploymentType === "DEDICATED_ON_PREMISE" ? <Badge tone="accent">استقرار اختصاصی</Badge> : null}
                  </div>
                  <div className="text-[11.5px] text-muted mt-1 font-mono truncate" dir="ltr">
                    {t.slug} · {t.dbName}
                  </div>
                  {t.suspendReason ? <div className="text-[11.5px] text-danger mt-1">دلیل تعلیق: {t.suspendReason}</div> : null}
                </Link>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap mt-3.5 pt-3.5 border-t border-border">
                <div className="flex items-center gap-3 flex-wrap text-[11.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <UsersIcon className="w-3.5 h-3.5" />
                    {toPersianDigits(t._count.memberships)} عضو
                  </span>
                  <span>{formatJalaliDate(t.createdAt)}</span>
                  {t.subscriptions[0] ? <Badge tone="primary">{t.subscriptions[0].plan.name}</Badge> : <span>بدون اشتراک</span>}
                </div>
                <div className="flex items-center gap-2 max-sm:w-full [&>*]:max-sm:flex-1 [&>*]:max-sm:text-center">
                  <Link href={`/tenants/${t.id}`} className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg">
                    مدیریت
                  </Link>
                  {t.status === "ACTIVE" ? (
                    <button onClick={() => setSuspendTarget(t)} className="text-[12px] font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer">
                      تعلیق
                    </button>
                  ) : t.status === "SUSPENDED" ? (
                    <button onClick={() => handleReactivate(t)} className="text-[12px] font-bold text-success bg-success-soft px-3 py-2 rounded-lg cursor-pointer">
                      فعال‌سازی مجدد
                    </button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {newTenantOpen ? <NewTenantModal onClose={() => setNewTenantOpen(false)} onCreated={reload} /> : null}

      {suspendTarget ? (
        <SuspendTenantModal
          tenant={suspendTarget}
          onClose={() => setSuspendTarget(null)}
          onSuspended={(updated) =>
            setTenants((prev) => prev?.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)) ?? prev)
          }
        />
      ) : null}
    </div>
  );
}
