"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { deleteInternalLead, updateInternalLead, ApiError, type InternalLead } from "@/lib/api";
import { formatToman } from "@/lib/persian";

const FIELD = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary";

/** جزئیات کامل فرصت فروش: مشاهده، تماس، ویرایش و حذف. */
export function LeadModal({ lead, onClose, onChanged }: { lead: InternalLead; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: lead.name, company: lead.company ?? "", phone: lead.phone ?? "", email: lead.email ?? "", value: String(lead.value ?? ""), notes: lead.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`فرصت فروش — ${lead.name}`} onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-3.5">
        {editing ? (
          <div className="grid grid-cols-2 gap-2.5">
            <input className={FIELD} placeholder="نام" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={FIELD} placeholder="شرکت" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <input className={FIELD} placeholder="موبایل" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={FIELD} placeholder="ایمیل" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className={FIELD} placeholder="ارزش تخمینی (تومان)" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            <textarea className={`${FIELD} col-span-2`} rows={3} placeholder="یادداشت" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="col-span-2 flex gap-2">
              <button
                disabled={busy || !form.name.trim()}
                onClick={() =>
                  run(async () => {
                    await updateInternalLead(lead.id, { name: form.name, company: form.company, phone: form.phone, email: form.email, value: form.value ? Number(form.value) : undefined, notes: form.notes });
                    onChanged();
                    onClose();
                  })
                }
                className="flex-1 py-2 rounded-lg bg-primary text-white text-[12.5px] font-bold disabled:opacity-50 cursor-pointer"
              >
                ذخیره
              </button>
              <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-lg bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer">انصراف</button>
            </div>
          </div>
        ) : (
          <>
            {lead.phone && (
              <a href={`tel:${lead.phone}`} dir="ltr" className="self-start text-[12.5px] font-bold text-primary bg-primary-soft px-3 py-1 rounded-lg">
                تماس با {lead.phone}
              </a>
            )}
            <div className="border border-border rounded-xl overflow-hidden text-[12.5px]">
              {[
                ["نام", lead.name],
                ["شرکت", lead.company],
                ["موبایل", lead.phone],
                ["ایمیل", lead.email],
                ["ارزش تخمینی", lead.value ? formatToman(lead.value) : null],
                ["مسئول", lead.owner?.name],
                ["پلن درخواستی", lead.requestedPlanCode],
                ["قالب صنفی", lead.requestedIndustryTemplateCode],
                ["تاریخ ثبت", new Date(lead.createdAt).toLocaleDateString("fa-IR")],
                ["یادداشت / خلاصه‌ی درخواست", lead.notes],
              ].map(([label, value]) => (
                <div key={label as string} className="flex border-b border-border last:border-b-0">
                  <div className="w-[130px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{label}</div>
                  <div className="flex-1 px-3 py-2.5 whitespace-pre-wrap">{(value as string) || "—"}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(true)} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer">ویرایش</button>
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm("این فرصت فروش حذف شود؟")) run(async () => { await deleteInternalLead(lead.id); onChanged(); onClose(); });
                }}
                className="text-[12px] font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 mr-auto"
              >
                حذف
              </button>
            </div>
          </>
        )}
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
      </div>
    </Modal>
  );
}
