"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  CrmIcon,
  WarehouseIcon,
  AccountingIcon,
  HrIcon,
  SearchIcon,
  StoreIcon,
} from "@/components/icons";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatToman } from "@/lib/persian";
import { fetchModules, installModule, uninstallModule, type ModuleCatalogItem } from "@/lib/api";

const moduleIcons: Record<string, { Icon: typeof CrmIcon; tone: string }> = {
  crm: { Icon: CrmIcon, tone: "bg-primary-soft text-primary" },
  warehouse: { Icon: WarehouseIcon, tone: "bg-accent-soft text-accent" },
  accounting: { Icon: AccountingIcon, tone: "bg-amber-100 text-amber-700" },
  hr: { Icon: HrIcon, tone: "bg-pink-100 text-pink-700" },
  reports: { Icon: AccountingIcon, tone: "bg-indigo-100 text-indigo-700" },
  store: { Icon: StoreIcon, tone: "bg-green-100 text-green-700" },
};

function isActive(m: ModuleCatalogItem) {
  return m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore);
}

export default function ModuleStorePage() {
  const [modules, setModules] = useState<ModuleCatalogItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("همه");
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  useEffect(() => {
    fetchModules().then(setModules).catch(() => setModules([]));
  }, []);

  const byCode = useMemo(() => new Map((modules ?? []).map((m) => [m.code, m])), [modules]);

  const categories = useMemo(() => {
    if (!modules) return ["همه"];
    return ["همه", ...Array.from(new Set(modules.map((m) => m.category)))];
  }, [modules]);

  const visible = useMemo(() => {
    if (!modules) return [];
    return modules.filter((m) => {
      const matchesCategory = activeCategory === "همه" || m.category === activeCategory;
      const matchesSearch = m.name.includes(search.trim());
      return matchesCategory && matchesSearch;
    });
  }, [modules, activeCategory, search]);

  async function handleInstall(code: string) {
    setPendingCode(code);
    try {
      const updated = await installModule(code);
      setModules((prev) => prev?.map((m) => (m.code === code ? { ...m, ...updated } : m)) ?? prev);
    } catch {
      // errors surface globally via ApiError; keep the store list as-is
    } finally {
      setPendingCode(null);
    }
  }

  async function handleUninstall(code: string) {
    setPendingCode(code);
    try {
      const updated = await uninstallModule(code);
      setModules((prev) => prev?.map((m) => (m.code === code ? { ...m, ...updated } : m)) ?? prev);
    } catch {
      // errors surface globally via ApiError; keep the store list as-is
    } finally {
      setPendingCode(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div>
        <h1 className="text-xl font-extrabold">ماژول‌های اکسیر ERP</h1>
        <p className="text-[13.5px] text-muted mt-1">
          امکانات مورد نیاز کسب‌وکارتان را انتخاب و در همان لحظه فعال کنید
        </p>
      </div>

      <div className="flex items-center gap-3 my-5 flex-wrap">
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white border border-border w-full sm:w-auto sm:min-w-[280px]">
          <SearchIcon className="w-4 h-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی ماژول..."
            className="text-[13px] bg-transparent outline-none w-full placeholder:text-muted"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={clsx(
                "text-[12.5px] font-semibold px-4 py-2 rounded-[10px] border",
                cat === activeCategory
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-ink-soft border-border",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {modules === null ? (
        <div className="text-center py-20 text-muted text-sm">در حال بارگذاری ماژول‌ها...</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((m) => {
            const { Icon, tone } = moduleIcons[m.code] ?? moduleIcons.reports;
            const active = isActive(m);
            const isPending = pendingCode === m.code;
            const prerequisites = m.dependsOn.map((code) => byCode.get(code)).filter((d): d is ModuleCatalogItem => !!d);
            const missingPrereqs = prerequisites.filter((d) => !isActive(d));
            // DISABLED (not null) means the tenant installed this before and
            // switched it off — reactivating is free, not a new purchase.
            const isReactivation = m.installStatus === "DISABLED";
            return (
              <Card key={m.id} className="p-5 flex flex-col gap-3.5">
                <div className="flex justify-between items-start">
                  <div className={clsx("w-11.5 h-11.5 rounded-[13px] flex items-center justify-center", tone)}>
                    <Icon className="w-5.5 h-5.5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.isCore && <Badge tone="accent">هسته</Badge>}
                    {active ? (
                      <Badge tone="success">فعال</Badge>
                    ) : m.priceMonthly > 0 ? (
                      <Badge tone="primary">محبوب</Badge>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-[15px] font-bold">{m.name}</div>
                    <span className="text-[10.5px] text-muted font-medium">نسخه {m.version}</span>
                  </div>
                  <div className="text-[12.5px] text-muted mt-1.5 leading-relaxed">{m.description}</div>
                </div>

                {prerequisites.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted">پیش‌نیاز:</span>
                    {prerequisites.map((dep) => (
                      <span
                        key={dep.code}
                        className={clsx(
                          "text-[10.5px] font-semibold px-2 py-1 rounded-lg",
                          isActive(dep) ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
                        )}
                      >
                        {dep.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex flex-col gap-2 pt-1">
                  {missingPrereqs.length > 0 && !active && (
                    <div className="text-[11px] text-danger">
                      ابتدا فعال کنید: {missingPrereqs.map((d) => d.name).join("، ")}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    {active ? (
                      <button
                        onClick={() => handleUninstall(m.code)}
                        disabled={isPending}
                        className="w-full py-2.5 rounded-[10px] border border-border bg-white text-ink-soft text-[12.5px] font-bold disabled:opacity-50"
                      >
                        {isPending ? "در حال غیرفعال‌سازی..." : "غیرفعال‌سازی"}
                      </button>
                    ) : m.priceMonthly > 0 && !isReactivation ? (
                      <>
                        <span className="text-[13px] font-bold">
                          {formatToman(m.priceMonthly)}
                          <span className="text-[11px] text-muted font-medium"> / ماه</span>
                        </span>
                        <button
                          onClick={() => handleInstall(m.code)}
                          disabled={isPending || missingPrereqs.length > 0}
                          className="py-2.25 px-4.5 rounded-[10px] bg-primary text-white text-[12.5px] font-bold disabled:opacity-50"
                        >
                          {isPending ? "در حال نصب..." : "خرید و نصب"}
                        </button>
                      </>
                    ) : isReactivation ? (
                      <button
                        onClick={() => handleInstall(m.code)}
                        disabled={isPending || missingPrereqs.length > 0}
                        className="w-full py-2.5 rounded-[10px] bg-primary text-white text-[12.5px] font-bold disabled:opacity-50"
                      >
                        {isPending ? "در حال فعال‌سازی..." : "فعال‌سازی مجدد (رایگان — قبلاً خریداری شده)"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstall(m.code)}
                        disabled={isPending || missingPrereqs.length > 0}
                        className="w-full py-2.5 rounded-[10px] bg-primary text-white text-[12.5px] font-bold disabled:opacity-50"
                      >
                        {isPending ? "در حال فعال‌سازی..." : "فعال‌سازی"}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
