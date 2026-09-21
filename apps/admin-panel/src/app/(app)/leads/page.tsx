"use client";

import { LeadModal } from "@/components/LeadModal";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { TargetIcon, PlusIcon } from "@/components/icons";
import { formatToman } from "@/lib/persian";
import {
  fetchInternalLeads,
  createInternalLead,
  updateLeadStage,
  assignLead,
  fetchStaff,
  type InternalLead,
  type LeadStage,
  type StaffMember,
} from "@/lib/api";
import { useAdmin } from "@/lib/admin-context";
import { NewTenantModal } from "@/components/tenants/NewTenantModal";

const STAGES: { key: LeadStage; label: string }[] = [
  { key: "NEW", label: "جدید" },
  { key: "CONTACTED", label: "تماس گرفته‌شده" },
  { key: "PROPOSAL", label: "پیشنهاد ارسال‌شده" },
  { key: "WON", label: "برنده" },
  { key: "LOST", label: "ازدست‌رفته" },
];

export default function LeadsPage() {
  const { admin } = useAdmin();
  const [leads, setLeads] = useState<InternalLead[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [openLead, setOpenLead] = useState<InternalLead | null>(null);
  const [convertLead, setConvertLead] = useState<InternalLead | null>(null);

  function reload() {
    fetchInternalLeads().then(setLeads).catch(() => setLeads([]));
  }
  useEffect(reload, []);
  useEffect(() => {
    fetchStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  async function handleStageChange(id: string, stage: LeadStage) {
    await updateLeadStage(id, stage);
    reload();
  }

  async function handleAssign(id: string, ownerAdminId: string) {
    await assignLead(id, ownerAdminId);
    reload();
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">فرصت‌های فروش اکسیر</h1>
          <p className="text-[13.5px] text-muted mt-1">مدیریت مشتریان بالقوه‌ی خود اکسیر — جدا از داده‌ی CRM هر تننت</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          فرصت جدید
        </button>
      </div>

      <Card className="mt-5 p-2">
        {leads === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <TargetIcon className="w-6 h-6" />
            فرصت فروشی ثبت نشده است
          </div>
        ) : (
          leads.map((lead, i) => (
            <div
              key={lead.id}
              onClick={() => setOpenLead(lead)}
              className={`flex items-center gap-3 px-4 py-3.5 flex-wrap cursor-pointer hover:bg-slate-50 ${
                i < leads.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex-1 min-w-[160px]">
                <div className="text-[13px] font-bold">{lead.name}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {[lead.company, lead.phone, lead.email].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              {lead.value ? <div className="text-[12.5px] font-bold shrink-0">{formatToman(lead.value)}</div> : null}
              <select
                value={lead.stage}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleStageChange(lead.id, e.target.value as LeadStage)}
                className="text-[12px] font-bold bg-slate-50 border border-border rounded-lg px-2.5 py-1.5 cursor-pointer shrink-0"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={lead.owner?.id ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => e.target.value && handleAssign(lead.id, e.target.value)}
                className="text-[12px] bg-slate-50 border border-border rounded-lg px-2.5 py-1.5 cursor-pointer shrink-0"
              >
                <option value="" disabled>
                  مسئول...
                </option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === admin?.id ? `${s.name} (من)` : s.name}
                  </option>
                ))}
              </select>
              {lead.stage !== "WON" ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConvertLead(lead);
                  }}
                  className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer shrink-0"
                >
                  تبدیل به تننت
                </button>
              ) : null}
            </div>
          ))
        )}
      </Card>

      {openLead ? <LeadModal lead={openLead} onClose={() => setOpenLead(null)} onChanged={reload} /> : null}
      {createOpen ? <CreateLeadModal onClose={() => setCreateOpen(false)} onCreated={reload} /> : null}

      {convertLead ? (
        <NewTenantModal
          onClose={() => setConvertLead(null)}
          onCreated={() => {
            handleStageChange(convertLead.id, "WON");
          }}
          initial={{
            name: convertLead.company || convertLead.name,
            ownerName: convertLead.name,
            ownerPhone: convertLead.phone ?? undefined,
            planCode: convertLead.requestedPlanCode ?? undefined,
            industryTemplateCode: convertLead.requestedIndustryTemplateCode ?? undefined,
          }}
        />
      ) : null}
    </div>
  );
}

function CreateLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createInternalLead({
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        value: value ? Number(value) : undefined,
      });
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="فرصت فروش جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نام مخاطب</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">شرکت</label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">شماره تماس</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            dir="ltr"
          />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">ارزش تخمینی (تومان)</label>
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت فرصت فروش"}
        </button>
      </form>
    </Modal>
  );
}
