"use client";

import { useEffect, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { createCrmContact, fetchCrmContacts, ApiError, type CrmContact } from "@/lib/api";
import { inputClass, labelClass } from "./constants";

export type PickedContact = { id: string; name: string; company: string | null; phone?: string | null };

/** انتخاب مشتری از CRM با جستجوی سرور (debounce) یا ساخت سریع مشتری جدید. */
export function ContactPicker({ value, onChange }: { value: PickedContact | null; onChange: (c: PickedContact | null) => void }) {
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 300);
  const begin = useRequestGuard();
  const [results, setResults] = useState<CrmContact[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [qName, setQName] = useState("");
  const [qPhone, setQPhone] = useState("");
  const [qCompany, setQCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value) return;
    const isCurrent = begin();
    const term = debounced.trim();
    fetchCrmContacts(term || undefined)
      .then((r) => {
        if (isCurrent()) setResults(r.slice(0, 8));
      })
      .catch(() => {
        if (isCurrent()) setResults([]);
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(term);
      });
  }, [debounced, value, begin]);

  async function handleQuickCreate() {
    if (qName.trim().length < 2) {
      setError("نام مشتری را وارد کنید");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await createCrmContact({ name: qName.trim(), phone: qPhone.trim() || undefined, company: qCompany.trim() || undefined });
      onChange({ id: c.id, name: c.name, company: c.company, phone: c.phone });
      setQuick(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ساخت مشتری ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 bg-primary-soft rounded-xl px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-bold truncate">{value.company || value.name}</div>
          {value.company ? <div className="text-[11.5px] text-ink-soft truncate">{value.name}</div> : null}
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-[12px] font-bold text-primary cursor-pointer shrink-0">
          تغییر
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchInput value={q} onChange={setQ} placeholder="جستجوی مشتری (نام، شرکت، موبایل)..." loading={loadedFor === null || loadedFor !== q.trim()} />
      <div className="border border-border rounded-xl overflow-hidden max-h-[170px] overflow-y-auto">
        {results.length === 0 ? (
          <div className="text-[12px] text-muted text-center py-3">{loadedFor === null ? "در حال بارگذاری..." : "مشتری‌ای یافت نشد"}</div>
        ) : (
          results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange({ id: c.id, name: c.name, company: c.company, phone: c.phone })}
              className="w-full text-right px-3.5 py-2 border-b border-border last:border-b-0 hover:bg-primary-soft cursor-pointer"
            >
              <div className="text-[12.5px] font-semibold">{c.company || c.name}</div>
              <div className="text-[11px] text-muted">
                {c.company ? `${c.name} · ` : ""}
                {c.phone ?? "بدون شماره"}
              </div>
            </button>
          ))
        )}
      </div>
      {quick ? (
        <div className="border border-border rounded-xl p-3 flex flex-col gap-2 bg-slate-50">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>نام مشتری</span>
            <input value={qName} onChange={(e) => setQName(e.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>موبایل</span>
              <input value={qPhone} onChange={(e) => setQPhone(e.target.value)} inputMode="tel" dir="ltr" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>شرکت (اختیاری)</span>
              <input value={qCompany} onChange={(e) => setQCompany(e.target.value)} className={inputClass} />
            </label>
          </div>
          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <div className="flex gap-2">
            <button type="button" onClick={handleQuickCreate} disabled={busy} className="flex-1 py-2 rounded-xl bg-primary text-white text-[12.5px] font-bold disabled:opacity-50 cursor-pointer">
              {busy ? "در حال ثبت..." : "ثبت و انتخاب"}
            </button>
            <button type="button" onClick={() => setQuick(false)} className="flex-1 py-2 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer">
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setQuick(true)} className="text-[12px] font-bold text-primary self-start cursor-pointer">
          + مشتری جدید
        </button>
      )}
    </div>
  );
}
