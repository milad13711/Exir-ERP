import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { toDateTimeLocalValue } from "@/lib/persian";
import {
  createAppointment,
  fetchCrmContacts,
  fetchUsers,
  type ServiceType,
  type CrmContact,
  type TenantUser,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewAppointmentModal({
  serviceTypes,
  defaultStart,
  onClose,
  onCreated,
}: {
  serviceTypes: ServiceType[];
  defaultStart: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [serviceTypeId, setServiceTypeId] = useState(serviceTypes[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [providerUserId, setProviderUserId] = useState("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startAt, setStartAt] = useState(toDateTimeLocalValue(defaultStart));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  function pickContact(id: string) {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.name);
      setCustomerPhone(c.phone ?? "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!serviceTypeId || !customerName.trim() || !startAt) return;
    setSaving(true);
    setError(null);
    try {
      await createAppointment({
        serviceTypeId,
        contactId: contactId || undefined,
        providerUserId: providerUserId || undefined,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        startAt: new Date(startAt).toISOString(),
        notes: notes.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت نوبت ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="نوبت جدید" onClose={onClose} width="max-w-[480px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نوع خدمت</label>
          <select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)} className={inputClass}>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.durationMinutes} دقیقه)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>مخاطب (اختیاری)</label>
          <select value={contactId} onChange={(e) => pickContact(e.target.value)} className={inputClass}>
            <option value="">بدون مخاطب — مشتری جدید</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>نام مشتری</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>تلفن مشتری</label>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} dir="ltr" className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass}>کارشناس ارائه‌دهنده (اختیاری)</label>
          <select value={providerUserId} onChange={(e) => setProviderUserId(e.target.value)} className={inputClass}>
            <option value="">بدون تخصیص کارشناس</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>زمان شروع</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            dir="ltr"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>یادداشت (اختیاری)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
        </div>

        {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}

        <button
          type="submit"
          disabled={saving || !serviceTypeId || !customerName.trim()}
          className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? "در حال ثبت..." : "ثبت نوبت"}
        </button>
      </form>
    </Modal>
  );
}
