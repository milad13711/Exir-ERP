import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { saveIndustryTemplateFromTenant, ApiError } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

/**
 * Bootstraps a new IndustryTemplate from this tenant's own already-configured
 * roles, chart-of-accounts, product categories, theme, and active modules —
 * see AdminCatalogController.saveIndustryTemplateFromTenant. Faster than
 * hand-writing a template's JSON from scratch when a tenant already looks
 * like a good reference for its industry.
 */
export function SaveAsTemplateModal({
  tenantId,
  tenantName,
  onClose,
  onSaved,
}: {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await saveIndustryTemplateFromTenant(tenantId, {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setDone(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`ساخت قالب صنف از «${tenantName}»`} onClose={onClose} width="max-w-[480px]">
      {done ? (
        <div className="text-center py-4">
          <div className="text-[13.5px] font-bold text-success mb-2">قالب صنف ساخته شد ✓</div>
          <p className="text-[12.5px] text-muted leading-relaxed">
            نقش‌ها، کدینگ حسابداری، دسته‌بندی کالا، رنگ تم و ماژول‌های فعال این تننت به‌عنوان پیش‌فرض قالب ذخیره شد. برای
            تکمیل چارت سازمانی، از تب «قالب‌های صنفی» در کاتالوگ ویرایشش کنید.
          </p>
          <button
            onClick={onClose}
            className="mt-4 w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer"
          >
            بستن
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <p className="text-[12.5px] text-muted leading-relaxed">
            نقش‌های سفارشی، کدینگ حسابداری، دسته‌بندی کالاها، رنگ تم، و ماژول‌های فعال این تننت به‌عنوان پیش‌فرض یک قالب
            صنفی جدید ذخیره می‌شود — چارت سازمانی جداگانه باید بعداً وارد شود.
          </p>
          <div>
            <label className={labelClass}>کد قالب</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
              dir="ltr"
              placeholder="my-industry"
            />
          </div>
          <div>
            <label className={labelClass}>نام صنف</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>توضیح</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
          </div>
          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <button
            type="submit"
            disabled={submitting || !code.trim() || !name.trim()}
            className="mt-1 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ساخت..." : "ساخت قالب صنف"}
          </button>
        </form>
      )}
    </Modal>
  );
}
