import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { createCrmContact, fetchCrmContacts, type CrmContact } from "@/lib/api";

const SOURCE_OPTIONS = ["اینستاگرام", "معرفی", "وب‌سایت", "تلفنی", "حضوری", "سایر"];

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
  const [source, setSource] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [referrerQuery, setReferrerQuery] = useState("");
  const [referrerOptions, setReferrerOptions] = useState<CrmContact[]>([]);
  const [referrer, setReferrer] = useState<CrmContact | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function searchReferrer(q: string) {
    setReferrerQuery(q);
    setReferrer(null);
    if (q.trim().length < 2) {
      setReferrerOptions([]);
      return;
    }
    const results = await fetchCrmContacts(q.trim());
    setReferrerOptions(results.slice(0, 6));
  }

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
        source: source.trim() || undefined,
        birthDate: birthDate || undefined,
        acquisitionCost: acquisitionCost.trim() ? Number(acquisitionCost) : undefined,
        referredById: referrer?.id,
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

        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-primary font-bold">جزئیات بیشتر</summary>
          <div className="flex flex-col gap-3.5 mt-3">
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
            <div>
              <label className={labelClass}>منبع آشنایی (اختیاری)</label>
              <div className="flex flex-wrap gap-1.5">
                {SOURCE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(source === s ? "" : s)}
                    className={`text-[11.5px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${source === s ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>تاریخ تولد (اختیاری)</label>
              <JalaliDateInput value={birthDate} onChange={setBirthDate} placeholder="انتخاب تاریخ تولد" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>هزینه‌ی جذب (تومان، اختیاری)</label>
                <input
                  value={acquisitionCost}
                  onChange={(e) => setAcquisitionCost(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  className={inputClass}
                  dir="ltr"
                />
              </div>
              <div className="relative">
                <label className={labelClass}>معرف (اختیاری)</label>
                <input
                  value={referrer ? referrer.name : referrerQuery}
                  onChange={(e) => searchReferrer(e.target.value)}
                  placeholder="جستجوی نام مخاطب..."
                  className={inputClass}
                />
                {referrerOptions.length > 0 && !referrer ? (
                  <div className="absolute z-10 top-full mt-1 w-full bg-white border border-border rounded-xl shadow-lg overflow-hidden">
                    {referrerOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setReferrer(c);
                          setReferrerOptions([]);
                        }}
                        className="w-full text-right px-3 py-2 text-[12.5px] hover:bg-slate-50 cursor-pointer"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </details>

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
