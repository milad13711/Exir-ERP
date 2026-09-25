"use client";

import { useEffect, useState } from "react";
import { BTN_PRIMARY } from "@/components/ui/styles";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon } from "@/components/icons";
import { formatToman } from "@/lib/persian";
import { toPersianDigits } from "@/lib/persian";
import {
  fetchCatalogModules,
  fetchCatalogPlans,
  fetchIndustryTemplates,
  fetchIndustryTemplate,
  type CatalogModule,
  type CatalogPlan,
  type IndustryTemplate,
  type IndustryTemplateDetail,
} from "@/lib/api";
import { EditModuleModal } from "@/components/catalog/EditModuleModal";
import { EditPlanModal } from "@/components/catalog/EditPlanModal";
import { EditIndustryTemplateModal } from "@/components/catalog/EditIndustryTemplateModal";

type Tab = "modules" | "plans" | "industries";

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("modules");
  const [modules, setModules] = useState<CatalogModule[] | null>(null);
  const [plans, setPlans] = useState<CatalogPlan[] | null>(null);
  const [templates, setTemplates] = useState<IndustryTemplate[] | null>(null);
  const [editModule, setEditModule] = useState<CatalogModule | null | "new">(null);
  const [editPlan, setEditPlan] = useState<CatalogPlan | null | "new">(null);
  const [editTemplate, setEditTemplate] = useState<IndustryTemplateDetail | null | "new">(null);
  const [templateLoading, setTemplateLoading] = useState(false);

  function reloadModules() {
    fetchCatalogModules().then(setModules).catch(() => setModules([]));
  }
  function reloadPlans() {
    fetchCatalogPlans().then(setPlans).catch(() => setPlans([]));
  }
  function reloadTemplates() {
    fetchIndustryTemplates().then(setTemplates).catch(() => setTemplates([]));
  }
  useEffect(() => {
    reloadModules();
    reloadPlans();
    reloadTemplates();
  }, []);

  async function openTemplate(code: string) {
    setTemplateLoading(true);
    try {
      setEditTemplate(await fetchIndustryTemplate(code));
    } finally {
      setTemplateLoading(false);
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader title="کاتالوگ ماژول‌ها و پلن‌ها" subtitle="قیمت‌گذاری و امکانات هرچه اینجا تغییر کند، فوراً در پنل تننت‌ها اثر می‌گذارد" action={<button
          onClick={() => {
            if (tab === "modules") setEditModule("new");
            else if (tab === "plans") setEditPlan("new");
            else setEditTemplate("new");
          }}
          className={BTN_PRIMARY}
        >
          <PlusIcon className="w-4 h-4" />
          {tab === "modules" ? "ماژول جدید" : tab === "plans" ? "پلن جدید" : "قالب صنف جدید"}
        </button>} />

      <div className="flex items-center gap-1.5 mt-6 p-1 bg-slate-100 rounded-2xl w-fit max-w-full overflow-x-auto">
        {(
          [
            ["modules", "ماژول‌ها"],
            ["plans", "پلن‌ها"],
            ["industries", "قالب‌های صنفی"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-[12.5px] font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              tab === key ? "bg-white text-primary shadow-sm" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "modules" ? (
        <div className="mt-5 flex flex-col gap-2.5">
          {modules === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            modules.map((m) => (
              <button
                key={m.id}
                onClick={() => setEditModule(m)}
                className={`w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-4 text-right cursor-pointer bg-surface border border-border rounded-2xl hover:border-primary/30 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors `}
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
                <div className="text-[13px] font-extrabold text-primary shrink-0">
                  {m.priceMonthly > 0 ? formatToman(m.priceMonthly) : "رایگان"}
                </div>
              </button>
            ))
          )}
        </div>
      ) : tab === "plans" ? (
        <div className="mt-5 flex flex-col gap-2.5">
          {plans === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            plans.map((p) => (
              <button
                key={p.id}
                onClick={() => setEditPlan(p)}
                className={`w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-4 text-right cursor-pointer bg-surface border border-border rounded-2xl hover:border-primary/30 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{p.name}</span>
                    {!p.isPubliclySold ? <Badge tone="warning">غیرعمومی</Badge> : null}
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">سقف {toPersianDigits(p.userLimit)} کاربر</div>
                </div>
                <div className="text-[13px] font-extrabold text-primary shrink-0">{formatToman(p.priceMonthly)}</div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2.5">
          {templates === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : templates.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز قالب صنفی ساخته نشده است</div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                onClick={() => openTemplate(t.code)}
                disabled={templateLoading}
                className={`w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-4 text-right cursor-pointer bg-surface border border-border rounded-2xl hover:border-primary/30 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors disabled:opacity-50 `}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold">{t.name}</div>
                  <div className="text-[11.5px] text-muted mt-1">{t.description}</div>
                </div>
                <span className="text-[11px] text-muted font-mono" dir="ltr">
                  {t.code}
                </span>
              </button>
            ))
          )}
        </div>
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

      {editTemplate ? (
        <EditIndustryTemplateModal
          template={editTemplate === "new" ? null : editTemplate}
          allModules={modules ?? []}
          onClose={() => setEditTemplate(null)}
          onSaved={reloadTemplates}
        />
      ) : null}
    </div>
  );
}
