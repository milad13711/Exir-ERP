import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { upsertCatalogPlan, ApiError, type CatalogPlan } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function EditPlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: CatalogPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [priceMonthly, setPriceMonthly] = useState(String(plan?.priceMonthly ?? 0));
  const [priceYearly, setPriceYearly] = useState(plan?.priceYearly != null ? String(plan.priceYearly) : "");
  const [userLimit, setUserLimit] = useState(String(plan?.userLimit ?? 5));
  const [isPubliclySold, setIsPubliclySold] = useState(plan?.isPubliclySold ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await upsertCatalogPlan({
        code: code.trim(),
        name: name.trim(),
        priceMonthly: Number(priceMonthly || 0),
        priceYearly: priceYearly.trim() ? Number(priceYearly) : undefined,
        userLimit: Number(userLimit || 1),
        isPubliclySold,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={plan ? `ویرایش پلن «${plan.name}»` : "پلن جدید"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>کد پلن</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!plan}
              className={`${inputClass} disabled:opacity-60`}
              dir="ltr"
              placeholder="starter"
            />
          </div>
          <div>
            <label className={labelClass}>نام نمایشی</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>قیمت ماهانه (تومان)</label>
            <input
              value={priceMonthly}
              onChange={(e) => setPriceMonthly(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className={labelClass}>قیمت سالانه (تومان، اختیاری)</label>
            <input
              value={priceYearly}
              onChange={(e) => setPriceYearly(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
              placeholder={`پیش‌فرض: ${(Number(priceMonthly || 0) * 12).toLocaleString("en-US")}`}
            />
          </div>
          <div>
            <label className={labelClass}>سقف کاربر</label>
            <input
              value={userLimit}
              onChange={(e) => setUserLimit(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={isPubliclySold}
            onChange={(e) => setIsPubliclySold(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-primary)]"
          />
          در فروشگاه عمومی نمایش داده شود
        </label>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !code.trim() || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ذخیره..." : "ذخیره پلن"}
        </button>
      </form>
    </Modal>
  );
}
