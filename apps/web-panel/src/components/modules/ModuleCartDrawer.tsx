"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { formatToman } from "@/lib/persian";
import { checkoutModules, ApiError, type ModuleCatalogItem, type ModuleBillingMode } from "@/lib/api";

const BILLING_MODE_LABELS: Record<ModuleBillingMode, string> = {
  MONTHLY: "ماهانه",
  YEARLY: "سالانه",
  LICENSE: "لایسنس (خرید یک‌باره)",
};

function moduleYearlyPrice(m: ModuleCatalogItem): number {
  return m.priceYearly ?? m.priceMonthly * 12;
}

function priceForMode(m: ModuleCatalogItem, mode: ModuleBillingMode): number {
  if (mode === "MONTHLY") return m.priceMonthly;
  if (mode === "YEARLY") return moduleYearlyPrice(m);
  return moduleYearlyPrice(m) * 8;
}

export function ModuleCartDrawer({
  items,
  onRemove,
  onClose,
  onCheckedOut,
}: {
  items: ModuleCatalogItem[];
  onRemove: (code: string) => void;
  onClose: () => void;
  onCheckedOut: () => void;
}) {
  const router = useRouter();
  const [billingMode, setBillingMode] = useState<ModuleBillingMode>("MONTHLY");
  const [agreed, setAgreed] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => items.reduce((sum, m) => sum + priceForMode(m, billingMode), 0), [items, billingMode]);

  async function handleCheckout() {
    setPaying(true);
    setError(null);
    try {
      const { invoiceId } = await checkoutModules(items.map((m) => ({ code: m.code, billingMode })));
      onCheckedOut();
      router.push(`/pay/${invoiceId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "صدور فاکتور ناموفق بود");
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div
        dir="rtl"
        className="fixed bottom-0 inset-x-0 sm:inset-x-auto sm:bottom-6 sm:end-6 z-50 w-full sm:w-[420px] bg-surface border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-extrabold">سبد خرید ماژول‌ها</h3>
          <button onClick={onClose} className="text-[12.5px] text-muted cursor-pointer">
            بستن
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center text-[12.5px] text-muted py-8">سبد خرید خالی است</div>
        ) : (
          <>
            <div className="flex flex-col gap-2 mb-4">
              {items.map((m) => (
                <div key={m.code} className="flex items-center justify-between bg-slate-50 rounded-xl px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold">{m.name}</span>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[12.5px] text-muted" dir="ltr">
                      {formatToman(priceForMode(m, billingMode))}
                    </span>
                    <button onClick={() => onRemove(m.code)} className="text-[11.5px] text-danger font-bold cursor-pointer">
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <div className="text-[12px] font-semibold text-ink-soft mb-2">دوره‌ی فاکتور</div>
              <div className="flex items-center gap-1.5 bg-slate-50 rounded-xl p-1">
                {(Object.keys(BILLING_MODE_LABELS) as ModuleBillingMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setBillingMode(mode)}
                    className={clsx(
                      "flex-1 py-2 rounded-lg text-[12px] font-bold transition-colors",
                      billingMode === mode ? "bg-primary text-white" : "text-ink-soft",
                    )}
                  >
                    {BILLING_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between bg-primary-soft rounded-xl px-4 py-3.5 mb-4">
              <span className="text-[12.5px] font-bold text-primary">مبلغ کل فاکتور</span>
              <span className="text-[16px] font-extrabold text-primary" dir="ltr">
                {formatToman(total)}
              </span>
            </div>

            <label className="flex items-start gap-2 text-[11.5px] text-ink-soft leading-relaxed mb-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>
                با فعال‌سازی و پرداخت این ماژول‌ها، شرایط استفاده و صورتحساب دوره‌ای اکسیر ERP را می‌پذیرم. فعال‌سازی
                فقط پس از تأیید پرداخت انجام می‌شود.
              </span>
            </label>

            {error ? <div className="text-[12px] text-danger mb-2">{error}</div> : null}

            <button
              onClick={handleCheckout}
              disabled={!agreed || paying}
              className="w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              {paying ? "در حال صدور فاکتور..." : "صدور فاکتور و پرداخت"}
            </button>
          </>
        )}
      </div>
    </>
  );
}
