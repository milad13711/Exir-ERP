"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon } from "@/components/icons";
import { formatToman } from "@/lib/persian";
import { toPersianDigits } from "@/lib/persian";
import { fetchCatalogModules, fetchCatalogPlans, type CatalogModule, type CatalogPlan } from "@/lib/api";
import { EditModuleModal } from "@/components/catalog/EditModuleModal";
import { EditPlanModal } from "@/components/catalog/EditPlanModal";

type Tab = "modules" | "plans";

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("modules");
  const [modules, setModules] = useState<CatalogModule[] | null>(null);
  const [plans, setPlans] = useState<CatalogPlan[] | null>(null);
  const [editModule, setEditModule] = useState<CatalogModule | null | "new">(null);
  const [editPlan, setEditPlan] = useState<CatalogPlan | null | "new">(null);

  function reloadModules() {
    fetchCatalogModules().then(setModules).catch(() => setModules([]));
  }
  function reloadPlans() {
    fetchCatalogPlans().then(setPlans).catch(() => setPlans([]));
  }
  useEffect(() => {
    reloadModules();
    reloadPlans();
  }, []);

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">کاتالوگ ماژول‌ها و پلن‌ها</h1>
          <p className="text-[13.5px] text-muted mt-1">قیمت‌گذاری و امکانات هرچه اینجا تغییر کند، فوراً در پنل تننت‌ها اثر می‌گذارد</p>
        </div>
        <button
          onClick={() => (tab === "modules" ? setEditModule("new") : setEditPlan("new"))}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          {tab === "modules" ? "ماژول جدید" : "پلن جدید"}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-6 border-b border-border">
        {(
          [
            ["modules", "ماژول‌ها"],
            ["plans", "پلن‌ها"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors ${
              tab === key ? "border-primary text-primary" : "border-transparent text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "modules" ? (
        <Card className="mt-5 p-2">
          {modules === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            modules.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setEditModule(m)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < modules.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{m.name}</span>
                    <span className="text-[10.5px] text-muted font-medium">نسخه {m.version}</span>
                    {m.isCore ? <Badge tone="accent">پایه</Badge> : null}
                    <Badge tone="neutral">{m.category}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">{m.description}</div>
                  {m.features.length > 0 ? (
                    <div className="text-[11px] text-muted mt-1">{m.features.join(" · ")}</div>
                  ) : null}
                  {m.dependsOn.length > 0 ? (
                    <div className="text-[11px] text-muted mt-1">
                      پیش‌نیاز: {m.dependsOn.map((code) => modules.find((x) => x.code === code)?.name ?? code).join("، ")}
                    </div>
                  ) : null}
                </div>
                <div className="text-[13px] font-extrabold shrink-0">
                  {m.priceMonthly > 0 ? formatToman(m.priceMonthly) : "رایگان"}
                </div>
              </button>
            ))
          )}
        </Card>
      ) : (
        <Card className="mt-5 p-2">
          {plans === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            plans.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setEditPlan(p)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < plans.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{p.name}</span>
                    {!p.isPubliclySold ? <Badge tone="warning">غیرعمومی</Badge> : null}
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">سقف {toPersianDigits(p.userLimit)} کاربر</div>
                </div>
                <div className="text-[13px] font-extrabold shrink-0">{formatToman(p.priceMonthly)}</div>
              </button>
            ))
          )}
        </Card>
      )}

      {editModule ? (
        <EditModuleModal
          module={editModule === "new" ? null : editModule}
          allModules={modules ?? []}
          onClose={() => setEditModule(null)}
          onSaved={reloadModules}
        />
      ) : null}

      {editPlan ? (
        <EditPlanModal plan={editPlan === "new" ? null : editPlan} onClose={() => setEditPlan(null)} onSaved={reloadPlans} />
      ) : null}
    </div>
  );
}
