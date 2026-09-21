"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatToman } from "@/lib/persian";
import { fetchCatalogModules, createTenantModuleInvoice, ApiError, type CatalogModule, type ModuleBillingChoice } from "@/lib/api";

const MODE_LABEL: Record<ModuleBillingChoice, string> = { MONTHLY: "اشتراک ماهانه", YEARLY: "اشتراک سالانه", LICENSE: "لایسنس مادام‌العمر" };

/** همان قاعده‌ی سرور: سالانه = تعریف‌شده یا ۱۰× ماهانه؛ لایسنس = ۴× سالانه. */
function priceOf(m: CatalogModule, mode: ModuleBillingChoice): number {
  const yearly = m.priceYearly ?? m.priceMonthly * 10;
  return mode === "MONTHLY" ? m.priceMonthly : mode === "YEARLY" ? yearly : yearly * 4;
}

/** صدور فاکتور دستی برای تننت بر اساس ماژول‌های موردنیاز و نوع پرداخت (اشتراک یا لایسنس). */
export function ModuleInvoiceModal({ tenantId, tenantName, onClose, onIssued }: { tenantId: string; tenantName: string; onClose: () => void; onIssued: () => void }) {
  const [modules, setModules] = useState<CatalogModule[] | null>(null);
  const [selected, setSelected] = useState<Record<string, ModuleBillingChoice>>({});
  const [defaultMode, setDefaultMode] = useState<ModuleBillingChoice>("YEARLY");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalogModules().then((m) => setModules(m.filter((x) => x.priceMonthly > 0))).catch(() => setModules([]));
  }, []);

  const shown = useMemo(() => (modules ?? []).filter((m) => !search.trim() || m.name.includes(search.trim()) || m.code.includes(search.trim())), [modules, search]);
  const total = (modules ?? []).reduce((sum, m) => (selected[m.code] ? sum + priceOf(m, selected[m.code]) : sum), 0);
  const count = Object.keys(selected).length;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createTenantModuleInvoice(tenantId, { items: Object.entries(selected).map(([code, billingMode]) => ({ code, billingMode })), note: note.trim() || undefined });
      onIssued();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "صدور فاکتور ناموفق بود");
      setBusy(false);
    }
  }

  return (
    <Modal title={`فاکتور ماژول برای «${tenantName}»`} onClose={onClose} width="max-w-[640px]">
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-muted leading-relaxed">
          ماژول‌ها و نوع پرداخت را انتخاب کنید. مبلغ از قیمت کاتالوگ محاسبه می‌شود؛ بعد از پرداخت، ماژول‌ها خودکار فعال یا تمدید می‌شوند. فاکتور در صفحه‌ی اشتراک و صورتحساب تننت می‌آید و برای مدیران تننت اعلان می‌رود.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی ماژول..." className="flex-1 min-w-[160px] text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2" />
          <select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value as ModuleBillingChoice)} className="text-[12.5px] bg-slate-50 border border-border rounded-xl px-3 py-2">
            {(Object.keys(MODE_LABEL) as ModuleBillingChoice[]).map((m) => (
              <option key={m} value={m}>
                نوع پیش‌فرض: {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[320px] overflow-y-auto border border-border rounded-xl">
          {modules === null ? (
            <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            shown.map((m) => {
              const mode = selected[m.code];
              return (
                <div key={m.code} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-border last:border-b-0">
                  <input
                    type="checkbox"
                    checked={!!mode}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[m.code] = defaultMode;
                        else delete next[m.code];
                        return next;
                      })
                    }
                    className="w-4 h-4 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{m.name}</div>
                    <div className="text-[11px] text-muted">{formatToman(priceOf(m, mode ?? defaultMode))}</div>
                  </div>
                  {mode && (
                    <select value={mode} onChange={(e) => setSelected((prev) => ({ ...prev, [m.code]: e.target.value as ModuleBillingChoice }))} className="text-[12px] bg-slate-50 border border-border rounded-lg px-2 py-1.5">
                      {(Object.keys(MODE_LABEL) as ModuleBillingChoice[]).map((x) => (
                        <option key={x} value={x}>
                          {MODE_LABEL[x]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })
          )}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح برای مشتری (اختیاری، همراه اعلان)" className="text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5" />
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13.5px] font-extrabold">
            {count} ماژول — جمع: {formatToman(total)}
          </div>
          <button disabled={busy || count === 0} onClick={submit} className="text-[13px] font-bold text-white bg-primary px-5 py-2.5 rounded-xl disabled:opacity-50 cursor-pointer">
            {busy ? "در حال صدور..." : "صدور فاکتور و اعلان به مشتری"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
