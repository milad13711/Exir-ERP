import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createCrmContact, type CrmContact } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewContactModal({
  onClose,
  onCreated,
  initialPhone,
}: {
  onClose: () => void;
  onCreated: (contact: CrmContact) => void;
  initialPhone?: string;
}) {
  const [type, setType] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const contact = await createCrmContact({
        type,
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      onCreated(contact);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="مخاطب جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType("INDIVIDUAL")}
            className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === "INDIVIDUAL" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
          >
            شخص حقیقی
          </button>
          <button
            type="button"
            onClick={() => setType("COMPANY")}
            className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === "COMPANY" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
          >
            شرکت
          </button>
        </div>
        <div>
          <label className={labelClass}>نام {type === "COMPANY" ? "مسئول ارتباط" : ""}</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً سارا محمدی"
            className={inputClass}
          />
        </div>
        {type === "COMPANY" ? (
          <div>
            <label className={labelClass}>نام شرکت</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="مثلاً پارسیان تک"
              className={inputClass}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>شماره تماس</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09121234567"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label className={labelClass}>ایمیل</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.ir"
              className={inputClass}
              dir="ltr"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن مخاطب"}
        </button>
      </form>
    </Modal>
  );
}
