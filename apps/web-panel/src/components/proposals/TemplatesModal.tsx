"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatJalaliDate, formatToman } from "@/lib/persian";
import { ApiError, deleteProposalTemplate, fetchProposalTemplates, updateProposalTemplate, type ProposalTemplate } from "@/lib/api";
import { inputClass, labelClass } from "./constants";

/** مدیریت قالب‌ها: فهرست، ویرایش (نام/عنوان/متن/شرایط)، حذف. ساخت قالب از جزئیات هر پروپوزال انجام می‌شود. */
export function TemplatesModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ProposalTemplate[] | null>(null);
  const [editing, setEditing] = useState<ProposalTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetchProposalTemplates().then(setList).catch(() => setList([]));
  }
  useEffect(reload, []);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await updateProposalTemplate(editing.id, {
        name: editing.name,
        title: editing.title,
        content: editing.content,
        durationText: editing.durationText,
        amount: editing.amount,
        paymentMethodText: editing.paymentMethodText,
        paymentTerms: editing.paymentTerms,
        paymentDeadline: editing.paymentDeadline,
        bankInfo: editing.bankInfo,
        validDays: editing.validDays,
      });
      setEditing(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: ProposalTemplate) {
    if (!window.confirm(`قالب «${t.name}» حذف شود؟`)) return;
    try {
      await deleteProposalTemplate(t.id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حذف ناموفق بود");
    }
  }

  return (
    <Modal title="قالب‌های پروپوزال" onClose={onClose} width="max-w-[640px]">
      {error ? <div className="text-[12.5px] text-danger mb-2">{error}</div> : null}
      {editing ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>نام قالب</span>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>عنوان پروپوزال</span>
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>متن</span>
            <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={10} className={`${inputClass} resize-y leading-7`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>مدت پیاده‌سازی</span>
              <input value={editing.durationText ?? ""} onChange={(e) => setEditing({ ...editing, durationText: e.target.value || null })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>مبلغ (تومان)</span>
              <input type="number" min={0} value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: Math.max(0, Number(e.target.value) || 0) })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>روش پرداخت</span>
              <input value={editing.paymentMethodText ?? ""} onChange={(e) => setEditing({ ...editing, paymentMethodText: e.target.value || null })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>مهلت اعتبار (روز)</span>
              <input type="number" min={1} value={editing.validDays ?? ""} onChange={(e) => setEditing({ ...editing, validDays: e.target.value ? Math.max(1, Number(e.target.value)) : null })} className={inputClass} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>شیوه‌ی پرداخت</span>
            <textarea value={editing.paymentTerms ?? ""} onChange={(e) => setEditing({ ...editing, paymentTerms: e.target.value || null })} rows={2} className={`${inputClass} resize-y`} />
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">ذخیره</button>
            <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">انصراف</button>
          </div>
        </div>
      ) : list === null ? (
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : list.length === 0 ? (
        <div className="py-8 text-center text-muted text-[13px] leading-7">قالبی ندارید. در جزئیات هر پروپوزال، «ذخیره به‌عنوان قالب» را بزنید.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border border-border rounded-xl px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{t.name}</div>
                <div className="text-[11.5px] text-muted truncate">
                  {t.title} · {formatToman(t.amount)} · {formatJalaliDate(t.updatedAt)}
                </div>
              </div>
              <button onClick={() => setEditing(t)} className="text-[12px] font-bold text-primary cursor-pointer">ویرایش</button>
              <button onClick={() => remove(t)} className="text-[12px] font-bold text-danger cursor-pointer">حذف</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
