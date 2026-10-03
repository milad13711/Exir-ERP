import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ApiError, fetchAutoSalePriceEnabled, updateAutoSalePriceEnabled } from "@/lib/api";

export function SalesPricingSettingsModal({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAutoSalePriceEnabled().then((r) => setEnabled(r.enabled));
  }, []);

  async function handleToggle() {
    if (enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      await updateAutoSalePriceEnabled(next);
      setEnabled(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد و تغییر ذخیره نشد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="تنظیمات فروش" onClose={onClose} width="max-w-[560px]">
      <p className="text-[12.5px] text-muted mb-4">
        وقتی این گزینه فعال باشد، برای کالاهایی که «درصد سود» دارند، با هر تغییر بهای تمام‌شده از یک رسید واقعی (خرید یا
        رسید انبار)، قیمت فروش به‌طور خودکار با فرمول «بهای تمام‌شده × (۱ + درصد سود ÷ ۱۰۰)» بازمحاسبه می‌شود. اگر
        قیمت فروش کالایی را مستقیماً ویرایش کرده باشید، آن کالا از این بازمحاسبه‌ی خودکار مستثنی می‌شود تا وقتی دوباره
        درصد سودش را ذخیره کنید. غیرفعال‌کردن این گزینه فقط بازمحاسبه‌ی خودکار را متوقف می‌کند — درصد سود کالاها همچنان
        در ورود اکسل و ویرایش کالا ذخیره می‌شود.
      </p>
      <button
        type="button"
        onClick={handleToggle}
        disabled={saving || enabled === null}
        className={`w-full text-right border rounded-xl p-3.5 cursor-pointer transition-colors disabled:opacity-60 ${
          enabled ? "border-primary bg-primary-soft" : "border-border bg-slate-50 hover:border-primary/40"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[13.5px] font-bold text-ink">محاسبه خودکار قیمت فروش از درصد سود</span>
          <span className={`text-[11px] font-bold ${enabled ? "text-primary" : "text-muted"}`}>
            {enabled ? "فعال" : "غیرفعال"}
          </span>
        </div>
        <div className="text-[12px] text-muted mt-1">
          {enabled
            ? "با هر رسید، قیمت فروش کالاهای دارای درصد سود به‌روز می‌شود."
            : "قیمت فروش دیگر روی رسید بازمحاسبه نمی‌شود."}
        </div>
      </button>
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
    </Modal>
  );
}
