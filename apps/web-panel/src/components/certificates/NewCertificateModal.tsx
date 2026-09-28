"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { useWorkspace } from "@/lib/workspace-context";
import {
  issueCertificate,
  fetchEmployees,
  fetchCrmContacts,
  type Employee,
  type CrmContact,
  type Certificate,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export type PresetRecipient = { type: "EMPLOYEE"; employee: Employee } | { type: "CONTACT"; contact: CrmContact };

export function NewCertificateModal({
  onClose,
  onCreated,
  presetRecipient,
}: {
  onClose: () => void;
  onCreated: (cert: Certificate) => void;
  presetRecipient?: PresetRecipient;
}) {
  const { installedModules } = useWorkspace();
  const hrInstalled = installedModules.has("hr");
  const crmInstalled = installedModules.has("crm");

  const [recipientType, setRecipientType] = useState<"EMPLOYEE" | "CONTACT">(
    presetRecipient?.type ?? (hrInstalled ? "EMPLOYEE" : "CONTACT"),
  );

  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(presetRecipient?.type === "EMPLOYEE" ? presetRecipient.employee : null);

  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<CrmContact[]>([]);
  const [contact, setContact] = useState<CrmContact | null>(presetRecipient?.type === "CONTACT" ? presetRecipient.contact : null);

  const [titleFa, setTitleFa] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [items, setItems] = useState<{ titleFa: string; titleEn: string }[]>([]);
  const [durationHours, setDurationHours] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [score, setScore] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipientPicked = recipientType === "EMPLOYEE" ? !!employee : !!contact;
  const canSubmit = recipientPicked && titleFa.trim().length > 1;

  async function searchEmployee(q: string) {
    setEmployeeQuery(q);
    setEmployee(null);
    if (q.trim().length < 2) {
      setEmployeeOptions([]);
      return;
    }
    const results = await fetchEmployees(q.trim());
    setEmployeeOptions(results.slice(0, 6));
  }

  async function searchContact(q: string) {
    setContactQuery(q);
    setContact(null);
    if (q.trim().length < 2) {
      setContactOptions([]);
      return;
    }
    const results = await fetchCrmContacts(q.trim());
    setContactOptions(results.slice(0, 6));
  }

  function addItem() {
    setItems((prev) => [...prev, { titleFa: "", titleEn: "" }]);
  }
  function updateItem(index: number, patch: Partial<{ titleFa: string; titleEn: string }>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const cert = await issueCertificate({
        recipientType,
        employeeId: recipientType === "EMPLOYEE" ? employee?.id : undefined,
        crmContactId: recipientType === "CONTACT" ? contact?.id : undefined,
        titleFa: titleFa.trim(),
        titleEn: titleEn.trim() || undefined,
        items: items.filter((it) => it.titleFa.trim()).map((it) => ({ titleFa: it.titleFa.trim(), titleEn: it.titleEn.trim() || undefined })),
        durationHours: durationHours ? Number(durationHours) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        score: score ? Number(score) : undefined,
      });
      onCreated(cert);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "صدور گواهی ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="صدور گواهی جدید" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {!presetRecipient && hrInstalled && crmInstalled ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRecipientType("EMPLOYEE")}
              className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${recipientType === "EMPLOYEE" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              پرسنل
            </button>
            <button
              type="button"
              onClick={() => setRecipientType("CONTACT")}
              className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${recipientType === "CONTACT" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              مخاطب
            </button>
          </div>
        ) : null}

        {presetRecipient ? (
          <div>
            <label className={labelClass}>گیرنده</label>
            <div className={`${inputClass} bg-white`}>
              {presetRecipient.type === "EMPLOYEE" ? presetRecipient.employee.fullName : presetRecipient.contact.name}
            </div>
          </div>
        ) : recipientType === "EMPLOYEE" ? (
          <div className="relative">
            <label className={labelClass}>پرسنل</label>
            <input
              value={employee ? employee.fullName : employeeQuery}
              onChange={(e) => searchEmployee(e.target.value)}
              placeholder="جستجوی نام پرسنل..."
              className={inputClass}
            />
            {employeeOptions.length > 0 && !employee ? (
              <div className="absolute z-10 top-full mt-1 w-full bg-white border border-border rounded-xl shadow-lg overflow-hidden">
                {employeeOptions.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      setEmployee(e);
                      setEmployeeOptions([]);
                    }}
                    className="w-full text-right px-3 py-2 text-[12.5px] hover:bg-slate-50 cursor-pointer"
                  >
                    {e.fullName} <span className="text-muted">· {e.position}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="relative">
            <label className={labelClass}>مخاطب CRM</label>
            <input
              value={contact ? contact.name : contactQuery}
              onChange={(e) => searchContact(e.target.value)}
              placeholder="جستجوی نام مخاطب..."
              className={inputClass}
            />
            {contactOptions.length > 0 && !contact ? (
              <div className="absolute z-10 top-full mt-1 w-full bg-white border border-border rounded-xl shadow-lg overflow-hidden">
                {contactOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setContact(c);
                      setContactOptions([]);
                    }}
                    className="w-full text-right px-3 py-2 text-[12.5px] hover:bg-slate-50 cursor-pointer"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelClass}>عنوان گواهی (فارسی)</label>
            <input value={titleFa} onChange={(e) => setTitleFa(e.target.value)} placeholder="مثلاً دوره‌ی مدیریت فروش" className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>عنوان گواهی (انگلیسی، اختیاری)</label>
            <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="Sales Management Course" className={inputClass} dir="ltr" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={labelClass.replace("mb-1.5", "")}>آیتم‌های آموزش‌دیده (اختیاری)</label>
            <button type="button" onClick={addItem} className="text-[11.5px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer">
              + افزودن آیتم
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={it.titleFa}
                  onChange={(e) => updateItem(i, { titleFa: e.target.value })}
                  placeholder="عنوان آیتم (فارسی)"
                  className={inputClass}
                />
                <input
                  value={it.titleEn}
                  onChange={(e) => updateItem(i, { titleEn: e.target.value })}
                  placeholder="English (اختیاری)"
                  dir="ltr"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-2 rounded-lg cursor-pointer shrink-0"
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="مدت (ساعت)"
            dir="ltr"
            inputMode="numeric"
            className="flex-1 min-w-[100px] text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
          <JalaliDateInput value={startDate} onChange={setStartDate} placeholder="تاریخ شروع دوره" className="flex-1 min-w-[130px]" />
          <JalaliDateInput value={endDate} onChange={setEndDate} placeholder="تاریخ پایان دوره" className="flex-1 min-w-[130px]" />
          <input
            value={score}
            onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="امتیاز (از ۱۰۰)"
            dir="ltr"
            inputMode="numeric"
            className="flex-1 min-w-[110px] text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال صدور..." : "صدور گواهی"}
        </button>
      </form>
    </Modal>
  );
}
