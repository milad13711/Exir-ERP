import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createProduct, fetchCurrencies, type Currency, type Product } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewProductModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("عدد");
  const [category, setCategory] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [profitMarginPercent, setProfitMarginPercent] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [currencyId, setCurrencyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrencies().then((list) => setCurrencies(list.filter((c) => c.isActive))).catch(() => setCurrencies([]));
  }, []);

  const selectedCurrency = currencies.find((c) => c.id === currencyId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const product = await createProduct({
        sku: sku.trim(),
        name: name.trim(),
        unit: unit.trim() || undefined,
        category: category.trim() || undefined,
        costPrice: !currencyId && costPrice ? Number(costPrice) : undefined,
        salePrice: !currencyId && salePrice ? Number(salePrice) : undefined,
        reorderPoint: reorderPoint ? Number(reorderPoint) : undefined,
        currencyId: currencyId || undefined,
        costPriceFx: currencyId && costPrice ? Number(costPrice) : undefined,
        salePriceFx: currencyId && salePrice ? Number(salePrice) : undefined,
        profitMarginPercent: !currencyId && profitMarginPercent ? Number(profitMarginPercent) : undefined,
      });
      onCreated(product);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="کالای جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>کد کالا (SKU)</label>
            <input
              autoFocus
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="P-1001"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label className={labelClass}>واحد اندازه‌گیری</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>نام کالا</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً لپ‌تاپ ایسوس Vivobook"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>دسته‌بندی</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="مثلاً لوازم دیجیتال"
            className={inputClass}
          />
        </div>
        {currencies.length > 0 ? (
          <div>
            <label className={labelClass}>ارز قیمت‌گذاری</label>
            <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} className={inputClass}>
              <option value="">تومان</option>
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>بهای تمام‌شده{currencyId ? ` (${selectedCurrency?.code})` : ""}</label>
            <input
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value.replace(currencyId ? /[^0-9.]/g : /[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="decimal"
              placeholder="۰"
            />
          </div>
          <div>
            <label className={labelClass}>درصد سود{currencyId ? " (غیرفعال برای ارزی)" : ""}</label>
            <input
              value={profitMarginPercent}
              onChange={(e) => setProfitMarginPercent(e.target.value.replace(/[^0-9.]/g, ""))}
              disabled={!!currencyId}
              className={`${inputClass} disabled:opacity-50`}
              dir="ltr"
              inputMode="decimal"
              placeholder="مثلاً ۳۰"
            />
          </div>
          <div>
            <label className={labelClass}>
              قیمت فروش{currencyId ? ` (${selectedCurrency?.code})` : ""}
              {!currencyId && profitMarginPercent ? " (خودکار)" : ""}
            </label>
            <input
              value={
                !currencyId && profitMarginPercent && costPrice
                  ? String(Math.round(Number(costPrice) * (1 + Number(profitMarginPercent) / 100)))
                  : salePrice
              }
              onChange={(e) => setSalePrice(e.target.value.replace(currencyId ? /[^0-9.]/g : /[^0-9]/g, ""))}
              disabled={!currencyId && !!profitMarginPercent}
              className={`${inputClass} disabled:opacity-60`}
              dir="ltr"
              inputMode="decimal"
              placeholder="۰"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>نقطه سفارش</label>
          <input
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${inputClass} max-w-[160px]`}
            dir="ltr"
            inputMode="numeric"
            placeholder="۰"
          />
        </div>
        {currencyId && selectedCurrency && Number(salePrice) > 0 ? (
          <div className="text-[11.5px] text-muted">
            معادل تومانی فعلی: {Math.round(Number(salePrice) * Number(selectedCurrency.rate)).toLocaleString("en-US")} تومان
            (با نرخ {Number(selectedCurrency.rate).toLocaleString("en-US")})
          </div>
        ) : null}
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !sku.trim() || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن کالا"}
        </button>
      </form>
    </Modal>
  );
}
