import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createReseller, ApiError, type ResellerTier } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const TIER_LABELS: Record<ResellerTier, string> = { A_PLUS: "A+", A: "A", B: "B" };

export function NewResellerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [shabaNumber, setShabaNumber] = useState("");
  const [tier, setTier] = useState<ResellerTier>("B");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createReseller({
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        shabaNumber: shabaNumber.trim() || undefined,
        tier,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت نماینده با خطا مواجه شد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="نماینده‌ی جدید" onClose={onClose} width="max-w-[480px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نام مدیر نمایندگی</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
        </div>
        <div>
          <label className={labelClass}>نام مجموعه / شرکت</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>شماره تماس</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" className={inputClass} placeholder="09121234567" />
        </div>
        <div>
          <label className={labelClass}>آدرس دقیق</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>آدرس وبسایت</label>
          <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} dir="ltr" className={inputClass} placeholder="https://" />
        </div>
        <div>
          <label className={labelClass}>شماره شبا جهت تسویه</label>
          <input value={shabaNumber} onChange={(e) => setShabaNumber(e.target.value)} dir="ltr" className={inputClass} placeholder="IR..." />
        </div>
        <div>
          <label className={labelClass}>سطح نمایندگی</label>
          <div className="flex gap-2">
            {(["A_PLUS", "A", "B"] as ResellerTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`flex-1 text-[12px] font-bold py-2 rounded-lg border cursor-pointer ${tier === t ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
              >
                {TIER_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <div className="flex items-center justify-end gap-2 mt-1.5">
          <button type="button" onClick={onClose} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2 rounded-lg cursor-pointer">
            انصراف
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="text-[12px] font-bold text-white bg-primary px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {saving ? "در حال ثبت..." : "ثبت نماینده"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
