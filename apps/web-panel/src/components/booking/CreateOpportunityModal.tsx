import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { createAppointmentOpportunity, ApiError, type Appointment, type CrmDeal, type CrmDealStage } from "@/lib/api";

const STAGE_OPTIONS: { value: CrmDealStage; label: string }[] = [
  { value: "NEW", label: "جدید" },
  { value: "CONTACTED", label: "در تماس" },
  { value: "PROPOSAL", label: "پیشنهاد قیمت" },
  { value: "NEGOTIATION", label: "مذاکره" },
];

/** ساخت فرصت فروش در CRM برای پیگیریِ بعد از نوبتِ انجام‌شده — با خلاصه‌ای که پرسنل از گفتگو می‌نویسد. */
export function CreateOpportunityModal({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const [title, setTitle] = useState(`فرصت پیگیری بعد از نوبت با ${a.customerName}`);
  const [summary, setSummary] = useState("");
  const [value, setValue] = useState(String(a.serviceType.price || 0));
  const [stage, setStage] = useState<CrmDealStage>("NEW");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CrmDeal | null>(null);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const deal = await createAppointmentOpportunity(a.id, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        value: Number(value) || 0,
        stage,
      });
      setCreated(deal);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ساخت فرصت فروش ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal title="فرصت فروش ساخته شد" onClose={onClose} width="max-w-[480px]">
        <div className="flex flex-col gap-3 items-start">
          <div className="text-[13px] text-ink-soft">فرصت فروش «{created.title}» با موفقیت ساخته شد.</div>
          <Link href="/crm" className="text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white">مشاهده در CRM ←</Link>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="ایجاد فرصت فروش" onClose={onClose} width="max-w-[480px]">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">عنوان فرصت</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">خلاصه‌ی مذاکره</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="در نوبت چه چیزی مطرح شد؟ مشتری به چه چیزی علاقه نشان داد؟"
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-col gap-1.5 flex-1">
            <span className="text-[12px] font-semibold text-ink-soft">ارزش تخمینی (تومان)</span>
            <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary" dir="ltr" />
          </label>
          <label className="flex flex-col gap-1.5 flex-1">
            <span className="text-[12px] font-semibold text-ink-soft">مرحله</span>
            <select value={stage} onChange={(e) => setStage(e.target.value as CrmDealStage)} className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary">
              {STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
        <button disabled={busy || !title.trim()} onClick={save} className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer disabled:opacity-50">
          {busy ? "در حال ساخت..." : "ایجاد فرصت فروش"}
        </button>
      </div>
    </Modal>
  );
}
