import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { upsertCatalogModule, ApiError, type CatalogModule } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function EditModuleModal({
  module,
  onClose,
  onSaved,
}: {
  module: CatalogModule | null; // null => creating a new module
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(module?.code ?? "");
  const [name, setName] = useState(module?.name ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [category, setCategory] = useState(module?.category ?? "");
  const [priceMonthly, setPriceMonthly] = useState(String(module?.priceMonthly ?? 0));
  const [isCore, setIsCore] = useState(module?.isCore ?? false);
  const [featuresText, setFeaturesText] = useState((module?.features ?? []).join("\n"));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await upsertCatalogModule({
        code: code.trim(),
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        priceMonthly: Number(priceMonthly || 0),
        isCore,
        features: featuresText
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
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
    <Modal title={module ? `ویرایش ماژول «${module.name}»` : "ماژول جدید"} onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>کد ماژول</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!module}
              className={`${inputClass} disabled:opacity-60`}
              dir="ltr"
              placeholder="crm"
            />
          </div>
          <div>
            <label className={labelClass}>دسته‌بندی</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>نام نمایشی</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>توضیح کوتاه</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>امکانات (هر خط یک مورد)</label>
          <textarea
            value={featuresText}
            onChange={(e) => setFeaturesText(e.target.value)}
            rows={4}
            className={`${inputClass} resize-none`}
            placeholder={"مدیریت مخاطبین\nقیف فروش"}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
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
          <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer pb-2.5">
            <input
              type="checkbox"
              checked={isCore}
              onChange={(e) => setIsCore(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            ماژول پایه (برای همه‌ی تننت‌ها رایگان و پیش‌فرض)
          </label>
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !code.trim() || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ذخیره..." : "ذخیره ماژول"}
        </button>
      </form>
    </Modal>
  );
}
