import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { createProject, fetchCrmContacts, fetchUsers, type CrmContact, type TenantUser } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [managerUserId, setManagerUserId] = useState("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createProject({
        name: name.trim(),
        contactId: contactId || undefined,
        managerUserId: managerUserId || undefined,
        budget: budget ? Number(budget) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        description: description.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت پروژه ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="پروژه جدید" onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نام پروژه</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>کارفرما / مشتری (اختیاری)</label>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
            <option value="">بدون مخاطب — پروژه داخلی</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>مدیر پروژه (اختیاری)</label>
          <select value={managerUserId} onChange={(e) => setManagerUserId(e.target.value)} className={inputClass}>
            <option value="">بدون تخصیص</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>بودجه (تومان — اختیاری)</label>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={inputClass}
          />
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>تاریخ شروع (اختیاری)</label>
            <JalaliDateInput value={startDate} onChange={setStartDate} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>تاریخ پایان (اختیاری)</label>
            <JalaliDateInput value={endDate} onChange={setEndDate} className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass}>توضیحات (اختیاری)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? "در حال ثبت..." : "ثبت پروژه"}
        </button>
      </form>
    </Modal>
  );
}
