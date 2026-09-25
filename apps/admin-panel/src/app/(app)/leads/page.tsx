"use client";

import { LeadModal } from "@/components/LeadModal";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState, ListSkeleton } from "@/components/ui/EmptyState";
import { SELECT, BTN_SOFT, BTN_PRIMARY } from "@/components/ui/styles";
import { PageHeader } from "@/components/ui/PageHeader";
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
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">
      <PageHeader title="فرصت‌های فروش اکسیر" subtitle="مدیریت مشتریان بالقوه‌ی خود اکسیر — جدا از داده‌ی CRM هر تننت" action={<button
          onClick={() => setCreateOpen(true)}
          className={BTN_PRIMARY}
        >
          <PlusIcon className="w-4 h-4" />
          فرصت جدید
        </button>} />

      <div className="mt-5 flex flex-col gap-3">
        {leads === null ? (
          <ListSkeleton />
        ) : leads.length === 0 ? (
          <EmptyState icon={<TargetIcon className="w-6 h-6" />}>فرصت فروشی ثبت نشده است</EmptyState>
        ) : (
          leads.map((lead) => (
            <Card key={lead.id} className="p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setOpenLead(lead)}>
                <div className="min-w-0">
                  <div className="text-[14px] font-extrabold">{lead.name}</div>
                  <div className="text-[11.5px] text-muted mt-1 break-words">
                    {[lead.company, lead.phone, lead.email].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {lead.value ? <div className="text-[12.5px] font-extrabold text-primary shrink-0">{formatToman(lead.value)}</div> : null}
              </div>
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 mt-3.5 pt-3.5 border-t border-border">
                <select
                  value={lead.stage}
                  onChange={(e) => handleStageChange(lead.id, e.target.value as LeadStage)}
                  className={`${SELECT} sm:min-w-[130px]`}
                >
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <select
                  value={lead.owner?.id ?? ""}
                  onChange={(e) => e.target.value && handleAssign(lead.id, e.target.value)}
                  className={`${SELECT} sm:min-w-[130px]`}
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
                  <button onClick={() => setConvertLead(lead)} className={`${BTN_SOFT} col-span-2 sm:col-span-1 sm:ms-auto`}>
                    تبدیل به تننت
                  </button>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </div>

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
