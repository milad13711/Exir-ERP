"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BuildingIcon, UsersIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchTenants, reactivateTenant, type AdminTenant } from "@/lib/api";
import { NewTenantModal } from "@/components/tenants/NewTenantModal";
import { SuspendTenantModal } from "@/components/tenants/SuspendTenantModal";

const STATUS_LABELS: Record<AdminTenant["status"], string> = {
  PENDING_PROVISION: "در حال راه‌اندازی",
  ACTIVE: "فعال",
  SUSPENDED: "معلق",
  CANCELLED: "لغوشده",
};

const STATUS_TONES: Record<AdminTenant["status"], "success" | "warning" | "danger" | "neutral"> = {
  PENDING_PROVISION: "warning",
  ACTIVE: "success",
  SUSPENDED: "danger",
  CANCELLED: "neutral",
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<AdminTenant[] | null>(null);
  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<AdminTenant | null>(null);

  function reload() {
    fetchTenants().then(setTenants).catch(() => setTenants([]));
  }
  useEffect(reload, []);

  async function handleReactivate(tenant: AdminTenant) {
    const updated = await reactivateTenant(tenant.id);
    setTenants((prev) => prev?.map((t) => (t.id === tenant.id ? { ...t, ...updated } : t)) ?? prev);
  }

  const activeCount = tenants?.filter((t) => t.status === "ACTIVE").length ?? 0;

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">تننت‌ها</h1>
          <p className="text-[13.5px] text-muted mt-1">
            {tenants ? `${toPersianDigits(tenants.length)} تننت · ${toPersianDigits(activeCount)} فعال` : "..."}
          </p>
        </div>
        <button
          onClick={() => setNewTenantOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          تننت جدید
        </button>
      </div>

      <Card className="mt-6 p-2">
        {tenants === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : tenants.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز تننتی ثبت نشده است</div>
        ) : (
          tenants.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center gap-4 px-4 py-4 flex-wrap ${i < tenants.length - 1 ? "border-b border-border" : ""}`}
            >
              <Link href={`/tenants/${t.id}`} className="w-10 h-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <BuildingIcon className="w-5 h-5" />
              </Link>

              <Link href={`/tenants/${t.id}`} className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-bold hover:text-primary">{t.name}</span>
                  <Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                  {t.deploymentType === "DEDICATED_ON_PREMISE" ? (
                    <Badge tone="accent">استقرار اختصاصی</Badge>
                  ) : null}
                </div>
                <div className="text-[11.5px] text-muted mt-1 font-mono" dir="ltr">
                  {t.slug} · {t.dbName}
                </div>
                {t.suspendReason ? (
                  <div className="text-[11px] text-danger mt-1">دلیل تعلیق: {t.suspendReason}</div>
                ) : null}
              </Link>

              <div className="text-[11.5px] text-muted flex items-center gap-1.5 shrink-0">
                <UsersIcon className="w-3.5 h-3.5" />
                {toPersianDigits(t._count.memberships)} عضو
              </div>

              <div className="text-[11.5px] shrink-0 min-w-[110px]">
                {t.subscriptions[0] ? (
                  <Badge tone="primary">{t.subscriptions[0].plan.name}</Badge>
                ) : (
                  <span className="text-muted">بدون اشتراک</span>
                )}
              </div>

              <div className="text-[11px] text-muted shrink-0 min-w-[90px]">{formatJalaliDate(t.createdAt)}</div>

              <div className="shrink-0">
                {t.status === "ACTIVE" ? (
                  <button
                    onClick={() => setSuspendTarget(t)}
                    className="text-[11.5px] font-bold text-danger cursor-pointer"
                  >
                    تعلیق
                  </button>
                ) : t.status === "SUSPENDED" ? (
                  <button
                    onClick={() => handleReactivate(t)}
                    className="text-[11.5px] font-bold text-success cursor-pointer"
                  >
                    فعال‌سازی مجدد
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>

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
