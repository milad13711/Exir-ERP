"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  CrmIcon,
  WarehouseIcon,
  AccountingIcon,
  HrIcon,
  SearchIcon,
  TasksIcon,
  ReceiptIcon,
  OrdersIcon,
  BillingIcon,
  WarningIcon,
  CheckIcon,
  FactoryIcon,
  FlaskIcon,
  KeyIcon,
  WebhookIcon,
  BotIcon,
  CurrencyIcon,
  BoltIcon,
  PhoneIcon,
  SettingsIcon,
} from "@/components/icons";
import { formatToman } from "@/lib/persian";
import { fetchModules, installModule, uninstallModule, type ModuleCatalogItem } from "@/lib/api";
import { ModuleDemoModal } from "@/components/modules/ModuleDemoModal";
import { ModuleCartDrawer } from "@/components/modules/ModuleCartDrawer";
import { useWorkspace } from "@/lib/workspace-context";

type CategoryTheme = { accent: string; soft: string; icon: string };

const CATEGORY_THEME: Record<string, CategoryTheme> = {
  "بهره‌وری": { accent: "#475569", soft: "#47556914", icon: "#475569" },
  "فروش و مشتری": { accent: "#4338ca", soft: "#4338ca14", icon: "#4338ca" },
  "انبار": { accent: "#0d9488", soft: "#0d948814", icon: "#0d9488" },
  "مالی": { accent: "#b45309", soft: "#b4530914", icon: "#b45309" },
  "منابع انسانی": { accent: "#db2777", soft: "#db277714", icon: "#db2777" },
  "خرید و تأمین": { accent: "#7c3aed", soft: "#7c3aed14", icon: "#7c3aed" },
  "تولید": { accent: "#15803d", soft: "#15803d14", icon: "#15803d" },
  "یکپارچه‌سازی": { accent: "#1d4ed8", soft: "#1d4ed814", icon: "#1d4ed8" },
  "عمومی": { accent: "#0891b2", soft: "#0891b214", icon: "#0891b2" },
};
const DEFAULT_THEME: CategoryTheme = { accent: "#4338ca", soft: "#4338ca14", icon: "#4338ca" };

const MODULE_ICONS: Record<string, typeof CrmIcon> = {
  tasks: TasksIcon,
  crm: CrmIcon,
  warehouse: WarehouseIcon,
  accounting: AccountingIcon,
  hr: HrIcon,
  sales: ReceiptIcon,
  purchasing: OrdersIcon,
  checks: BillingIcon,
  "supplier-risk": WarningIcon,
  "delivery-signature": CheckIcon,
  production: FactoryIcon,
  "quality-control": FlaskIcon,
  "api-access": KeyIcon,
  webhooks: WebhookIcon,
  mcp: BotIcon,
  "currency-exchange": CurrencyIcon,
  "offline-sync": BoltIcon,
  voip: PhoneIcon,
  automation: SettingsIcon,
};

function isActive(m: ModuleCatalogItem) {
  return m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore);
}

/** فعال‌سازی رایگان/فوری (بدون رفتن به سبد خرید) — رایگان/هسته، لایسنس قبلاً خریداری‌شده، یا هنوز داخل دوره‌ی پرداخت‌شده. */
function canFreeActivate(m: ModuleCatalogItem): boolean {
  if (m.priceMonthly === 0) return true;
  if (m.billingMode === "LICENSE") return true;
  if (m.currentPeriodEnd && new Date(m.currentPeriodEnd).getTime() > Date.now()) return true;
  return false;
}

export default function ModuleStorePage() {
  const { me } = useWorkspace();
  const [modules, setModules] = useState<ModuleCatalogItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("همه");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [demoModuleCode, setDemoModuleCode] = useState<string | null>(null);
  const [cartCodes, setCartCodes] = useState<string[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const cartStorageKey = me?.tenant.slug ? `exir_module_cart_${me.tenant.slug}` : null;

  useEffect(() => {
    fetchModules().then(setModules).catch(() => setModules([]));
  }, []);

  useEffect(() => {
    if (!cartStorageKey) return;
    try {
      const saved = localStorage.getItem(cartStorageKey);
      if (saved) setCartCodes(JSON.parse(saved));
    } catch {
      // ignore — cart just starts empty
    }
  }, [cartStorageKey]);

  useEffect(() => {
    if (!cartStorageKey) return;
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cartCodes));
    } catch {
      // ignore — cart persistence is a convenience, not critical
    }
  }, [cartCodes, cartStorageKey]);

  function addToCart(code: string) {
    setCartCodes((prev) => (prev.includes(code) ? prev : [...prev, code]));
  }
  function removeFromCart(code: string) {
    setCartCodes((prev) => prev.filter((c) => c !== code));
  }

  const byCode = useMemo(() => new Map((modules ?? []).map((m) => [m.code, m])), [modules]);

  const categories = useMemo(() => {
    if (!modules) return ["همه"];
    return ["همه", ...Array.from(new Set(modules.map((m) => m.category)))];
  }, [modules]);

  const activeCount = useMemo(() => (modules ?? []).filter(isActive).length, [modules]);

  const visible = useMemo(() => {
    if (!modules) return [];
    return modules.filter((m) => {
      const matchesCategory = activeCategory === "همه" || m.category === activeCategory;
      const matchesSearch = m.name.includes(search.trim()) || m.description.includes(search.trim());
      return matchesCategory && matchesSearch;
    });
  }, [modules, activeCategory, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ModuleCatalogItem[]>();
    for (const m of visible) {
      const list = groups.get(m.category) ?? [];
      list.push(m);
      groups.set(m.category, list);
    }
    return Array.from(groups.entries());
  }, [visible]);

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
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-800 via-indigo-700 to-teal-600 px-6 py-8 sm:px-9 sm:py-10">
        <div
          className="absolute -top-16 left-10 w-56 h-56 rounded-full bg-white/10 blur-2xl pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute -bottom-20 right-0 w-72 h-72 rounded-full bg-teal-300/15 blur-3xl pointer-events-none"
          aria-hidden
        />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
          <div>
            <div className="text-white/70 text-[12.5px] font-semibold mb-2">فروشگاه ماژول</div>
            <h1 className="text-white text-2xl sm:text-[26px] font-extrabold leading-snug max-w-md">
              امکانات مورد نیاز کسب‌وکارتان را انتخاب و در همان لحظه فعال کنید
            </h1>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="bg-white/12 rounded-2xl px-5 py-3.5 text-center">
              <div className="text-white text-xl font-extrabold">{activeCount}</div>
              <div className="text-white/70 text-[11px] font-semibold mt-0.5">ماژول فعال</div>
            </div>
            <div className="bg-white/12 rounded-2xl px-5 py-3.5 text-center">
              <div className="text-white text-xl font-extrabold">{modules?.length ?? 0}</div>
              <div className="text-white/70 text-[11px] font-semibold mt-0.5">کل ماژول‌ها</div>
            </div>
          </div>
        </div>
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
          {categories.map((cat) => {
            const theme = CATEGORY_THEME[cat] ?? DEFAULT_THEME;
            const selected = cat === activeCategory;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className="text-[12.5px] font-semibold px-4 py-2 rounded-[10px] border transition-colors"
                style={
                  selected
                    ? { backgroundColor: theme.accent, borderColor: theme.accent, color: "#fff" }
                    : { backgroundColor: "#fff", borderColor: "var(--border)", color: "var(--ink-soft)" }
                }
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {modules === null ? (
        <div className="text-center py-20 text-muted text-sm">در حال بارگذاری ماژول‌ها...</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20 text-muted text-sm">ماژولی یافت نشد</div>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map(([category, items]) => {
            const theme = CATEGORY_THEME[category] ?? DEFAULT_THEME;
            return (
              <div key={category}>
                {activeCategory === "همه" && (
                  <div className="flex items-center gap-2.5 mb-3.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                    <h2 className="text-[14px] font-extrabold">{category}</h2>
                  </div>
                )}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((m) => {
                    const Icon = MODULE_ICONS[m.code] ?? TasksIcon;
                    const active = isActive(m);
                    const isPending = pendingCode === m.code;
                    const prerequisites = m.dependsOn.map((code) => byCode.get(code)).filter((d): d is ModuleCatalogItem => !!d);
                    const missingPrereqs = prerequisites.filter((d) => !isActive(d));
                    const isReactivation = m.installStatus === "DISABLED";
                    return (
                      <div
                        key={m.id}
                        className="relative overflow-hidden rounded-2xl bg-white border border-border p-5 flex flex-col gap-3.5"
                      >
                        <div
                          className="absolute -top-8 -left-8 w-28 h-28 rounded-full blur-2xl pointer-events-none"
                          style={{ backgroundColor: theme.soft }}
                          aria-hidden
                        />
                        <div className="relative flex justify-between items-start">
                          <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center"
                            style={{ backgroundColor: theme.soft, color: theme.icon }}
                          >
                            <Icon className="w-6 h-6" />
                          </div>
                          <div className="flex items-center gap-1.5">
                            {m.isCore && (
                              <span className="text-[10.5px] font-bold px-2 py-1 rounded-lg bg-slate-100 text-ink-soft">
                                هسته
                              </span>
                            )}
                            {active ? (
                              <span className="text-[10.5px] font-bold px-2 py-1 rounded-lg bg-success-soft text-success">
                                فعال
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="relative">
                          <div className="flex items-center gap-2">
                            <div className="text-[14.5px] font-bold">{m.name}</div>
                          </div>
                          <div className="text-[12px] text-muted mt-1.5 leading-relaxed">{m.description}</div>
                        </div>

                        {m.features.length > 0 && (
                          <ul className="relative flex flex-col gap-1.5">
                            {m.features.map((f) => (
                              <li key={f} className="flex items-start gap-1.5 text-[11.5px] text-ink-soft">
                                <CheckIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: theme.accent }} />
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {prerequisites.length > 0 && (
                          <div className="relative flex flex-wrap items-center gap-1.5">
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

                        <div className="relative mt-auto flex flex-col gap-2 pt-1">
                          {missingPrereqs.length > 0 && !active && (
                            <div className="text-[11px] text-danger">
                              ابتدا فعال کنید: {missingPrereqs.map((d) => d.name).join("، ")}
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            {active ? (
                              <button
                                onClick={() => handleUninstall(m.code)}
                                disabled={isPending}
                                className="w-full py-2.5 rounded-[10px] border border-border bg-white text-ink-soft text-[12.5px] font-bold disabled:opacity-50"
                              >
                                {isPending ? "در حال غیرفعال‌سازی..." : "غیرفعال‌سازی"}
                              </button>
                            ) : canFreeActivate(m) ? (
                              <button
                                onClick={() => handleInstall(m.code)}
                                disabled={isPending || missingPrereqs.length > 0}
                                className="w-full py-2.5 rounded-[10px] text-white text-[12.5px] font-bold disabled:opacity-50"
                                style={{ backgroundColor: theme.accent }}
                              >
                                {isPending
                                  ? "در حال فعال‌سازی..."
                                  : isReactivation
                                    ? "فعال‌سازی مجدد (رایگان — قبلاً خریداری شده)"
                                    : "فعال‌سازی"}
                              </button>
                            ) : (
                              <>
                                <span className="text-[13px] font-bold shrink-0">
                                  {formatToman(m.priceMonthly)}
                                  <span className="text-[11px] text-muted font-medium"> / ماه</span>
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => setDemoModuleCode(m.code)}
                                    className="py-2.25 px-3 rounded-[10px] border border-border bg-white text-ink-soft text-[12px] font-bold cursor-pointer"
                                  >
                                    دمو
                                  </button>
                                  {cartCodes.includes(m.code) ? (
                                    <button
                                      onClick={() => removeFromCart(m.code)}
                                      className="py-2.25 px-3.5 rounded-[10px] bg-success-soft text-success text-[12px] font-bold cursor-pointer"
                                    >
                                      در سبد خرید ✓
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => addToCart(m.code)}
                                      disabled={missingPrereqs.length > 0}
                                      className="py-2.25 px-3.5 rounded-[10px] text-white text-[12px] font-bold disabled:opacity-50 cursor-pointer"
                                      style={{ backgroundColor: theme.accent }}
                                    >
                                      افزودن به سبد خرید
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cartCodes.length > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 end-6 z-30 flex items-center gap-2.5 py-3.5 px-5 rounded-2xl bg-primary text-white text-[13.5px] font-bold shadow-lg cursor-pointer"
        >
          سبد خرید
          <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[12px]">
            {cartCodes.length}
          </span>
        </button>
      )}

      {cartOpen && (
        <ModuleCartDrawer
          items={cartCodes.map((code) => byCode.get(code)).filter((m): m is ModuleCatalogItem => !!m)}
          onRemove={removeFromCart}
          onClose={() => setCartOpen(false)}
          onCheckedOut={() => setCartCodes([])}
        />
      )}

      {demoModuleCode && byCode.get(demoModuleCode) && (
        <ModuleDemoModal
          module={byCode.get(demoModuleCode)!}
          onClose={() => setDemoModuleCode(null)}
          onActivated={() => fetchModules().then(setModules).catch(() => {})}
        />
      )}
    </div>
  );
}
