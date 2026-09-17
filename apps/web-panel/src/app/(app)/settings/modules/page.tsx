"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate } from "@/lib/persian";
import { fetchModules, installModule, uninstallModule, type ModuleCatalogItem } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function isActive(m: ModuleCatalogItem) {
  return m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore);
}

/** ماژولی که مشتری حداقل یک‌بار برایش پرداخت کرده (لایسنس دائمی، یا هنوز داخل دوره‌ی پرداخت‌شده) — فعال/غیرفعال کردنش دیگر رایگان است. */
function isOwned(m: ModuleCatalogItem): boolean {
  if (m.priceMonthly === 0 || m.isCore) return true;
  if (m.billingMode === "LICENSE") return true;
  if (m.currentPeriodEnd && new Date(m.currentPeriodEnd).getTime() > Date.now()) return true;
  return false;
}

export default function InstalledModulesSettingsPage() {
  const { refreshInstalledModules } = useWorkspace();
  const [modules, setModules] = useState<ModuleCatalogItem[] | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  function reload() {
    fetchModules().then(setModules).catch(() => setModules([]));
  }
  useEffect(reload, []);

  const ownedOrActive = useMemo(
    () => (modules ?? []).filter((m) => isActive(m) || isOwned(m)).sort((a, b) => Number(isActive(b)) - Number(isActive(a))),
    [modules],
  );

  async function handleToggle(m: ModuleCatalogItem) {
    setPendingCode(m.code);
    try {
      const updated = isActive(m) ? await uninstallModule(m.code) : await installModule(m.code);
      setModules((prev) => prev?.map((x) => (x.code === m.code ? { ...x, ...updated } : x)) ?? prev);
      refreshInstalledModules();
    } catch {
      // errors surface globally via ApiError
    } finally {
      setPendingCode(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">ماژول‌های نصب‌شده</h1>
          <p className="text-[13.5px] text-muted mt-1">
            ماژول‌های فعال و ماژول‌هایی که پیش‌تر برایشان پرداخت شده — فعال/غیرفعال کردن این‌ها رایگان است.
          </p>
        </div>
        <Link
          href="/modules"
          className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl shrink-0"
        >
          فروشگاه ماژول‌ها
        </Link>
      </div>

      {modules === null ? (
        <div className="mt-8 text-center py-16 text-muted text-sm">در حال بارگذاری...</div>
      ) : ownedOrActive.length === 0 ? (
        <div className="mt-8 border-[1.5px] border-dashed border-border rounded-2xl py-16 flex flex-col items-center gap-3 text-muted">
          <span className="text-sm font-semibold">هنوز هیچ ماژولی فعال یا خریداری نشده است</span>
          <Link href="/modules" className="text-[12.5px] font-bold text-primary">
            رفتن به فروشگاه ماژول‌ها ←
          </Link>
        </div>
      ) : (
        <Card className="mt-6 p-2">
          {ownedOrActive.map((m, i) => {
            const active = isActive(m);
            const isPending = pendingCode === m.code;
            return (
              <div
                key={m.id}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
                  i < ownedOrActive.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[13.5px] font-bold truncate">{m.name}</div>
                    {m.isCore ? <Badge tone="neutral">هسته</Badge> : null}
                  </div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {m.category}
                    {m.billingMode === "LICENSE" ? " · لایسنس دائمی" : ""}
                    {!active && !m.isCore && m.currentPeriodEnd
                      ? ` · پرداخت‌شده تا ${formatJalaliDate(m.currentPeriodEnd)}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={active ? "success" : "neutral"}>{active ? "فعال" : "غیرفعال"}</Badge>
                  {!m.isCore && (
                    <button
                      type="button"
                      onClick={() => handleToggle(m)}
                      disabled={isPending}
                      className={`text-[11.5px] font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 ${
                        active ? "text-danger bg-danger-soft" : "text-success bg-success-soft"
                      }`}
                    >
                      {isPending ? "..." : active ? "غیرفعال‌سازی" : "فعال‌سازی مجدد"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
