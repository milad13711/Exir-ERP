"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { ApiError, fetchTaxProductCodes, removeTaxProductCode, saveTaxProductCode, type TaxProductRow } from "@/lib/api";
import { inputClass } from "./constants";

type Draft = { sstid: string; unitCode: string; vatRate: string };

/** نگاشت کالا → شناسه کالا/خدمت ۱۳ رقمی؛ جستجوی ajax سمت سرور و ذخیره‌ی درجا برای هر ردیف. */
export function TaxProductCodesTab({ canEdit }: { canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [rows, setRows] = useState<TaxProductRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const debounced = useDebouncedValue(q, 300);
  const begin = useRequestGuard();

  function load() {
    const isCurrent = begin();
    fetchTaxProductCodes({ q: debounced.trim() || undefined, unmapped: onlyUnmapped })
      .then((r) => isCurrent() && setRows(r))
      .catch(() => isCurrent() && setRows((p) => p ?? []));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [debounced, onlyUnmapped]);

  const draftOf = (r: TaxProductRow): Draft =>
    drafts[r.id] ?? { sstid: r.taxCode?.sstid ?? "", unitCode: r.taxCode ? String(r.taxCode.unitCode) : "", vatRate: r.taxCode?.vatRate === null || r.taxCode?.vatRate === undefined ? "" : String(r.taxCode.vatRate) };

  async function save(r: TaxProductRow) {
    const d = draftOf(r);
    setSavingId(r.id);
    setError(null);
    try {
      await saveTaxProductCode({ productId: r.id, sstid: d.sstid, unitCode: Number(d.unitCode), vatRate: d.vatRate.trim() === "" ? null : Number(d.vatRate) });
      setDrafts((p) => {
        const { [r.id]: _omit, ...rest } = p;
        void _omit;
        return rest;
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ذخیره ناموفق بود");
    } finally {
      setSavingId(null);
    }
  }

  async function remove(r: TaxProductRow) {
    if (!window.confirm(`نگاشت «${r.name}» حذف شود؟`)) return;
    try {
      await removeTaxProductCode(r.id);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "حذف ناموفق بود");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <SearchInput className="max-w-[320px] flex-1 min-w-[220px]" value={q} onChange={setQ} placeholder="جستجوی نام یا کد کالا..." loading={rows === null} />
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer">
          <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
          فقط بدون نگاشت
        </label>
      </div>
      {error ? <div className="text-[12.5px] text-danger mb-2">{error}</div> : null}
      {rows === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted text-sm">کالایی یافت نشد</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const d = draftOf(r);
            const set = (patch: Partial<Draft>) => setDrafts((p) => ({ ...p, [r.id]: { ...d, ...patch } }));
            return (
              <Card key={r.id} className="p-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate">{r.name}</div>
                    <div className="text-[11.5px] text-muted">{r.sku} · {r.unit}</div>
                  </div>
                  {r.taxCode ? <Badge tone="success">نگاشت‌شده</Badge> : <Badge tone="warning">پیش‌فرض تنظیمات</Badge>}
                </div>
                {canEdit ? (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_110px_auto] gap-2 mt-2.5 items-center">
                    <input dir="ltr" maxLength={13} placeholder="شناسه ۱۳ رقمی کالا/خدمت" className={inputClass} value={d.sstid} onChange={(e) => set({ sstid: e.target.value.trim() })} />
                    <input dir="ltr" placeholder="کد واحد" className={inputClass} value={d.unitCode} onChange={(e) => set({ unitCode: e.target.value.trim() })} />
                    <input dir="ltr" placeholder="نرخ ٪ (اختیاری)" className={inputClass} value={d.vatRate} onChange={(e) => set({ vatRate: e.target.value })} />
                    <div className="flex items-center gap-2">
                      <button disabled={savingId === r.id || !/^\d{13}$/.test(d.sstid) || !d.unitCode} onClick={() => save(r)} className="text-[12px] font-bold px-3.5 py-2 rounded-xl bg-primary text-white cursor-pointer disabled:opacity-50">
                        ذخیره
                      </button>
                      {r.taxCode ? (
                        <button onClick={() => remove(r)} className="text-[12px] font-bold px-3 py-2 rounded-xl bg-surface border border-border text-danger cursor-pointer">
                          حذف
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : r.taxCode ? (
                  <div dir="ltr" className="text-[12px] font-mono text-muted mt-2">{r.taxCode.sstid} · unit {r.taxCode.unitCode}</div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
