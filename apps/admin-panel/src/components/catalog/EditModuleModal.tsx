import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { upsertCatalogModule, ApiError, type CatalogModule } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function EditModuleModal({
  module,
  allModules,
  onClose,
  onSaved,
}: {
  module: CatalogModule | null; // null => creating a new module
  allModules: CatalogModule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(module?.code ?? "");
  const [name, setName] = useState(module?.name ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [category, setCategory] = useState(module?.category ?? "");
  const [priceMonthly, setPriceMonthly] = useState(String(module?.priceMonthly ?? 0));
  const [licenseUsd, setLicenseUsd] = useState(String(module?.licenseUsd ?? 0));
  const [priceYearly, setPriceYearly] = useState(module?.priceYearly ? String(module.priceYearly) : "");
  const [isCore, setIsCore] = useState(module?.isCore ?? false);
  const [featuresText, setFeaturesText] = useState((module?.features ?? []).join("\n"));
  const [version, setVersion] = useState(module?.version ?? "1.0.0");
  const [dependsOn, setDependsOn] = useState<string[]>(module?.dependsOn ?? []);
  const [demoDescription, setDemoDescription] = useState(module?.demoDescription ?? "");
  const [demoValuePropsText, setDemoValuePropsText] = useState((module?.demoValueProps ?? []).join("\n"));
  const [demoScreenshot1Url, setDemoScreenshot1Url] = useState(module?.demoScreenshot1Url ?? "");
  const [demoScreenshot2Url, setDemoScreenshot2Url] = useState(module?.demoScreenshot2Url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDependency(depCode: string) {
    setDependsOn((prev) => (prev.includes(depCode) ? prev.filter((c) => c !== depCode) : [...prev, depCode]));
  }

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
        priceMonthly: Number(licenseUsd) > 0 ? undefined : Number(priceMonthly || 0),
        licenseUsd: Number(licenseUsd || 0),
        isCore,
        features: featuresText
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
        version: version.trim() || "1.0.0",
        dependsOn,
        priceYearly: Number(licenseUsd) > 0 ? undefined : priceYearly ? Number(priceYearly) : undefined,
        demoDescription: demoDescription.trim() || undefined,
        demoValueProps: demoValuePropsText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        demoScreenshot1Url: demoScreenshot1Url.trim() || undefined,
        demoScreenshot2Url: demoScreenshot2Url.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  const otherModules = allModules.filter((m) => m.code !== module?.code);

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
        <div className="bg-primary-soft rounded-xl p-3.5 flex flex-col gap-2">
          <label className={labelClass}>قیمت پایه‌ی دلاری (لایسنس مادام‌العمر)</label>
          <input
            value={licenseUsd}
            onChange={(e) => setLicenseUsd(e.target.value.replace(/[^0-9]/g, ""))}
            className={inputClass}
            dir="ltr"
            inputMode="numeric"
          />
          <div className="text-[11.5px] text-ink-soft leading-6">
            اگر بیش از صفر باشد، همه‌ی قیمت‌ها از همین عدد مشتق می‌شوند و با نرخ روز دلار خودکار به‌روز می‌شوند: سالانه = لایسنس ÷ ۴، ماهانه = سالانه ÷ ۱۰. صفر یعنی قیمت تومانی دستی (پایین).
            {Number(licenseUsd) > 0 ? " قیمت‌های دستی زیر نادیده گرفته می‌شود." : ""}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <label className={labelClass}>قیمت ماهانه (تومان)</label>
            <input
              value={priceMonthly}
              disabled={Number(licenseUsd) > 0}
              onChange={(e) => setPriceMonthly(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className={labelClass}>قیمت سالانه (تومان)</label>
            <input
              value={priceYearly}
              disabled={Number(licenseUsd) > 0}
              onChange={(e) => setPriceYearly(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
              placeholder={priceMonthly ? String(Number(priceMonthly) * 12) : "۱۲ برابر ماهانه"}
            />
          </div>
          <div>
            <label className={labelClass}>ورژن</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass} dir="ltr" placeholder="1.0.0" />
          </div>
        </div>
        <div className="text-[11px] text-muted -mt-1.5">
          قیمت لایسنس (خرید یک‌باره، مادام‌العمر) خودکار محاسبه می‌شود: ۴ برابر قیمت سالانه؛ سالانه = ۱۰ برابر ماهانه.
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={isCore}
            onChange={(e) => setIsCore(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-primary)]"
          />
          ماژول پایه (برای همه‌ی تننت‌ها رایگان و پیش‌فرض)
        </label>
        {otherModules.length > 0 ? (
          <div>
            <label className={labelClass}>پیش‌نیازها (باید قبلاً فعال باشند)</label>
            <div className="flex flex-wrap gap-2">
              {otherModules.map((m) => (
                <label
                  key={m.code}
                  className={`flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                    dependsOn.includes(m.code) ? "border-primary bg-primary-soft text-primary" : "border-border bg-slate-50 text-ink-soft"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={dependsOn.includes(m.code)}
                    onChange={() => toggleDependency(m.code)}
                    className="w-3.5 h-3.5 accent-[var(--color-primary)]"
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="border-t border-border pt-3.5 mt-1">
          <div className="text-[13px] font-bold mb-2.5">محتوای دموی ماژول</div>
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelClass}>توضیح دمو</label>
              <textarea
                value={demoDescription}
                onChange={(e) => setDemoDescription(e.target.value)}
                rows={2}
                className={`${inputClass} resize-none`}
                placeholder="این ماژول چه کاری انجام می‌دهد و چرا به کار کسب‌وکار می‌آید"
              />
            </div>
            <div>
              <label className={labelClass}>ارزش‌های ایجادشده برای سازمان (هر خط یک مورد)</label>
              <textarea
                value={demoValuePropsText}
                onChange={(e) => setDemoValuePropsText(e.target.value)}
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder={"صرفه‌جویی در زمان ثبت سفارش\nکاهش خطای انسانی در انبار"}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>آدرس تصویر ۱ (URL)</label>
                <input
                  value={demoScreenshot1Url}
                  onChange={(e) => setDemoScreenshot1Url(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className={labelClass}>آدرس تصویر ۲ (URL)</label>
                <input
                  value={demoScreenshot2Url}
                  onChange={(e) => setDemoScreenshot2Url(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>
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
