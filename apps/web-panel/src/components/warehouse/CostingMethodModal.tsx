import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ApiError, fetchCostingMethod, updateCostingMethod, type CostingMethod } from "@/lib/api";

const OPTIONS: Array<{ value: CostingMethod; label: string; description: string }> = [
  {
    value: "LAST_COST",
    label: "آخرین قیمت خرید",
    description: "بهای هر کالا با هر رسید جدید، با آخرین قیمت خرید جایگزین می‌شود. ساده‌ترین روش — رفتار پیش‌فرض سیستم.",
  },
  {
    value: "WEIGHTED_AVERAGE",
    label: "میانگین موزون",
    description: "با هر رسید، میانگین وزنی موجودی قبلی و رسید تازه محاسبه و به‌عنوان بهای کالا ذخیره می‌شود.",
  },
  {
    value: "FIFO",
    label: "اولین صادره از اولین وارده (FIFO)",
    description: "بهای هر خروج از قدیمی‌ترین رسیدهای هنوز مصرف‌نشده محاسبه می‌شود — دقیق‌ترین روش، مبتنی بر تاریخچه‌ی کامل رسیدها.",
  },
];

export function CostingMethodModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState<CostingMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCostingMethod().then((r) => setCurrent(r.method));
  }, []);

  async function handleSelect(method: CostingMethod) {
    if (method === current || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateCostingMethod(method);
      setCurrent(method);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد و تغییر ذخیره نشد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="روش بهای تمام‌شده‌ی موجودی" onClose={onClose} width="max-w-[560px]">
      <p className="text-[12.5px] text-muted mb-4">
        این روش تعیین می‌کند در محاسبه‌ی بهای تمام‌شده‌ی کالای فروخته‌شده (COGS) و سود ناخالص، چگونه قیمت خرید کالاها
        در نظر گرفته شود. تغییر این تنظیم فقط روی فروش‌های بعدی اثر می‌گذارد.
      </p>
      <div className="flex flex-col gap-2.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleSelect(opt.value)}
            disabled={saving || current === null}
            className={`text-right border rounded-xl p-3.5 cursor-pointer transition-colors disabled:opacity-60 ${
              current === opt.value ? "border-primary bg-primary-soft" : "border-border bg-slate-50 hover:border-primary/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-bold text-ink">{opt.label}</span>
              {current === opt.value ? <span className="text-[11px] font-bold text-primary">فعال</span> : null}
            </div>
            <div className="text-[12px] text-muted mt-1">{opt.description}</div>
          </button>
        ))}
      </div>
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
    </Modal>
  );
}
