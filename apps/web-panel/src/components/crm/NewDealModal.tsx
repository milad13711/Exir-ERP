import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ContactCombobox } from "@/components/shared/ContactCombobox";
import { createCrmDeal, type CrmDeal } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewDealModal({
  defaultContactId,
  onClose,
  onCreated,
}: {
  defaultContactId?: string;
  onClose: () => void;
  onCreated: (deal: CrmDeal) => void;
}) {
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(defaultContactId ?? "");
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>عنوان فرصت</label>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً فروش لایسنس سالانه" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>مخاطب</label>
          <ContactCombobox
            value={contactId}
            onChange={(id) => setContactId(id)}
            source="customer"
            placeholder="جستجوی مخاطب (نام، شرکت، موبایل)..."
          />
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
          disabled={submitting || !title.trim() || !contactId}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن فرصت"}
        </button>
      </form>
    </Modal>
  );
}
