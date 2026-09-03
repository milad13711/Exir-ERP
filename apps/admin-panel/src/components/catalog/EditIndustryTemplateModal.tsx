import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  upsertIndustryTemplate,
  ApiError,
  type IndustryTemplateDetail,
  type CatalogModule,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";
const jsonClass = `${inputClass} font-mono text-[12px] resize-none`;

// roles/chartOfAccounts/orgChart are free-form JSON, edited as raw text —
// the same shape seed.ts always used. A structured form for three levels of
// nested per-role permission matrices would be a much bigger project than
// this template-authoring pass; JSON is what an engineer building a new
// template already understands, and this at least gets it off seed.ts/deploys.
function parseJsonArray(text: string, label: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`«${label}» یک JSON معتبر نیست`);
  }
  if (!Array.isArray(parsed)) throw new Error(`«${label}» باید یک آرایه‌ی JSON باشد`);
  return parsed;
}

export function EditIndustryTemplateModal({
  template,
  allModules,
  onClose,
  onSaved,
}: {
  template: IndustryTemplateDetail | null; // null => creating a new template
  allModules: CatalogModule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(template?.code ?? "");
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [suggestedThemeColor, setSuggestedThemeColor] = useState(template?.suggestedThemeColor ?? "#4338ca");
  const [defaultModules, setDefaultModules] = useState<string[]>(template?.defaultModules ?? []);
  const [productCategoriesText, setProductCategoriesText] = useState((template?.productCategories ?? []).join("\n"));
  const [rolesText, setRolesText] = useState(JSON.stringify(template?.roles ?? [], null, 2));
  const [chartOfAccountsText, setChartOfAccountsText] = useState(JSON.stringify(template?.chartOfAccounts ?? [], null, 2));
  const [orgChartText, setOrgChartText] = useState(JSON.stringify(template?.orgChart ?? [], null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleModule(moduleCode: string) {
    setDefaultModules((prev) => (prev.includes(moduleCode) ? prev.filter((c) => c !== moduleCode) : [...prev, moduleCode]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await upsertIndustryTemplate({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        roles: parseJsonArray(rolesText, "نقش‌ها"),
        chartOfAccounts: parseJsonArray(chartOfAccountsText, "کدینگ حسابداری"),
        orgChart: parseJsonArray(orgChartText, "چارت سازمانی"),
        productCategories: productCategoriesText
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean),
        suggestedThemeColor,
        defaultModules,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={template ? `ویرایش قالب «${template.name}»` : "قالب صنف جدید"} onClose={onClose} width="max-w-[640px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>کد قالب</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!template}
              className={`${inputClass} disabled:opacity-60`}
              dir="ltr"
              placeholder="livestock-feed"
            />
          </div>
          <div>
            <label className={labelClass}>نام صنف</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="خوراک دام" />
          </div>
        </div>
        <div>
          <label className={labelClass}>توضیح</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className={labelClass}>رنگ تم پیشنهادی</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={suggestedThemeColor}
                onChange={(e) => setSuggestedThemeColor(e.target.value)}
                className="w-11 h-11 rounded-lg border border-border cursor-pointer bg-transparent p-0.5 shrink-0"
              />
              <input
                value={suggestedThemeColor}
                onChange={(e) => setSuggestedThemeColor(e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </div>
          </div>
        </div>

        {allModules.length > 0 ? (
          <div>
            <label className={labelClass}>ماژول‌های پیش‌فرض (هنگام ساخت تننت خودکار نصب می‌شوند)</label>
            <div className="flex flex-wrap gap-2">
              {allModules.map((m) => (
                <label
                  key={m.code}
                  className={`flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                    m.isCore
                      ? "border-border bg-slate-50 text-muted"
                      : defaultModules.includes(m.code)
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border bg-slate-50 text-ink-soft"
                  }`}
                  title={m.isCore ? "ماژول پایه — همیشه فعال است" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={m.isCore || defaultModules.includes(m.code)}
                    disabled={m.isCore}
                    onChange={() => toggleModule(m.code)}
                    className="w-3.5 h-3.5 accent-[var(--color-primary)]"
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <label className={labelClass}>دسته‌بندی کالاهای پیشنهادی (هر خط یک مورد)</label>
          <textarea
            value={productCategoriesText}
            onChange={(e) => setProductCategoriesText(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label className={labelClass}>نقش‌های سازمانی (JSON)</label>
          <textarea value={rolesText} onChange={(e) => setRolesText(e.target.value)} rows={6} className={jsonClass} dir="ltr" />
        </div>
        <div>
          <label className={labelClass}>کدینگ حسابداری افزوده (JSON)</label>
          <textarea
            value={chartOfAccountsText}
            onChange={(e) => setChartOfAccountsText(e.target.value)}
            rows={5}
            className={jsonClass}
            dir="ltr"
          />
        </div>
        <div>
          <label className={labelClass}>چارت سازمانی (JSON)</label>
          <textarea value={orgChartText} onChange={(e) => setOrgChartText(e.target.value)} rows={5} className={jsonClass} dir="ltr" />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !code.trim() || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ذخیره..." : "ذخیره قالب صنف"}
        </button>
      </form>
    </Modal>
  );
}
