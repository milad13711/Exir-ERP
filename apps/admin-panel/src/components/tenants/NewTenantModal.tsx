import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { createTenant, fetchIndustryTemplates, ApiError, type IndustryTemplate } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const PLANS = [
  { code: "starter", label: "استارتر — ۴۹۰,۰۰۰ تومان/ماه" },
  { code: "professional", label: "حرفه‌ای — ۱,۹۹۰,۰۰۰ تومان/ماه" },
  { code: "enterprise", label: "سازمانی — ۴,۹۹۰,۰۰۰ تومان/ماه" },
];

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function NewTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [planCode, setPlanCode] = useState("starter");
  const [industryTemplateCode, setIndustryTemplateCode] = useState("");
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIndustryTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createTenant({
        name: name.trim(),
        slug: slug.trim(),
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim(),
        planCode,
        industryTemplateCode: industryTemplateCode || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  const valid = name.trim() && /^[a-z][a-z0-9-]{1,48}$/.test(slug) && ownerName.trim() && /^09\d{9}$/.test(ownerPhone);

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/40 p-4 overflow-y-auto">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-[480px] my-8 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-extrabold">تننت جدید</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:bg-primary-soft hover:text-primary cursor-pointer"
          >
            <CloseIcon className="w-4.5 h-4.5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3.5">
          <p className="text-[11.5px] text-muted -mt-1">
            یک دیتابیس کاملاً مجزا برای این تننت ساخته و مهاجرت‌ها روی آن اجرا می‌شود.
          </p>
          <div>
            <label className={labelClass}>نام سازمان</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="مثلاً شرکت فناوری پارسیان"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>شناسه (slug) — برای نام دیتابیس</label>
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="parsian-tech"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>نام مالک</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>موبایل مالک</label>
              <input
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="0912xxxxxxx"
                className={inputClass}
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>پلن اشتراک</label>
            <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className={inputClass}>
              {PLANS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {templates.length > 0 ? (
            <div>
              <label className={labelClass}>قالب صنف (اختیاری)</label>
              <select
                value={industryTemplateCode}
                onChange={(e) => setIndustryTemplateCode(e.target.value)}
                className={inputClass}
              >
                <option value="">بدون قالب — نقش‌ها و کدینگ حسابداری پیش‌فرض</option>
                {templates.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
              {industryTemplateCode ? (
                <>
                  <p className="text-[11px] text-muted mt-1.5">
                    {templates.find((t) => t.code === industryTemplateCode)?.description}
                  </p>
                  <p className="text-[11px] text-warning mt-1 font-semibold">
                    با انتخاب قالب صنف، بلافاصله فاکتور صادر می‌شود و تننت تا پرداخت آن قابل ورود نخواهد بود.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <button
            type="submit"
            disabled={submitting || !valid}
            className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ساخت دیتابیس و راه‌اندازی..." : "ساخت تننت"}
          </button>
        </form>
      </div>
    </div>
  );
}
