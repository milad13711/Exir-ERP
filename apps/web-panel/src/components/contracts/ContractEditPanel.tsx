"use client";

import { useState } from "react";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { useModuleCan } from "@/hooks/useModuleCan";
import { updateContract, deleteContract, ApiError, type Contract } from "@/lib/api";
import { moneyUnit } from "@/lib/persian";

const inputClass =
  "w-full min-h-10 text-[16px] sm:text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1 block";

/** ویرایش و حذف قرارداد «پیش‌نویس» (قرارداد امضاشده/فعال فقط الحاقیه یا فسخ دارد). */
export function ContractEditPanel({ contract, onChanged, onClose }: { contract: Contract; onChanged: () => void; onClose: () => void }) {
  const can = useModuleCan("contracts");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(contract.title);
  const [value, setValue] = useState(String(contract.value));
  const [startDate, setStartDate] = useState(contract.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(contract.endDate.slice(0, 10));
  const [category, setCategory] = useState(contract.category ?? "");
  const [terms, setTerms] = useState(contract.terms ?? "");
  const [guaranteeTerms, setGuaranteeTerms] = useState(contract.guaranteeTerms ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (contract.status !== "DRAFT" || contract.isLocked || contract.partyASignedAt || contract.partyBSignedAt) return null;
  if (!can.canEdit && !can.canDelete) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateContract(contract.id, {
        title: title.trim(),
        value: Number(value),
        startDate,
        endDate,
        category: category.trim() || undefined,
        terms: terms || undefined,
        guaranteeTerms: guaranteeTerms || undefined,
      });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-3">
      {can.canEdit ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-bold text-primary min-h-10 cursor-pointer">
            {open ? "بستن ویرایش" : "ویرایش قرارداد (پیش‌نویس)"}
          </button>
          {open ? (
            <form onSubmit={save} className="flex flex-col gap-2.5 mt-2">
              <div>
                <label className={labelClass}>عنوان</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>ارزش ({moneyUnit()})</label>
                  <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" dir="ltr" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>دسته‌بندی</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>تاریخ شروع</label>
                  <JalaliDateInput value={startDate} onChange={setStartDate} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>تاریخ پایان</label>
                  <JalaliDateInput value={endDate} onChange={setEndDate} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>شرح بندها و شرایط</label>
                <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>ضمانت اجرا</label>
                <textarea value={guaranteeTerms} onChange={(e) => setGuaranteeTerms(e.target.value)} rows={2} className={inputClass} />
              </div>
              {error ? <div className="text-[12px] text-danger">{error}</div> : null}
              <button type="submit" disabled={busy || !title.trim() || !value || !startDate || !endDate} className="min-h-10 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
                {busy ? "در حال ذخیره..." : "ذخیره‌ی تغییرات"}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      {can.canDelete ? (
        <DeleteRecordButton
          label="حذف قرارداد پیش‌نویس"
          confirmText="این قرارداد پیش‌نویس برای همیشه حذف شود؟"
          onDelete={() => deleteContract(contract.id)}
          onDeleted={() => {
            onChanged();
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
