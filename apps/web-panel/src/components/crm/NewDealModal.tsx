import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createCrmDeal, type CrmContact, type CrmDeal } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewDealModal({
  contacts,
  defaultContactId,
  onClose,
  onCreated,
}: {
  contacts: CrmContact[];
  defaultContactId?: string;
  onClose: () => void;
  onCreated: (deal: CrmDeal) => void;
}) {
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(defaultContactId ?? contacts[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !contactId) return;
    setSubmitting(true);
    try {
      const deal = await createCrmDeal({
        title: title.trim(),
        contactId,
        value: value ? Number(value) : undefined,
      });
      onCreated(deal);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="فرصت فروش جدید" onClose={onClose}>
      {contacts.length === 0 ? (
        <div className="text-[13px] text-muted text-center py-6">
          ابتدا باید حداقل یک مخاطب ثبت کنید.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div>
            <label className={labelClass}>عنوان فرصت</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً فروش لایسنس سالانه"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>مخاطب</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={inputClass}
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` — ${c.company}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>ارزش تقریبی (تومان)</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="۰"
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ثبت..." : "افزودن فرصت"}
          </button>
        </form>
      )}
    </Modal>
  );
}
